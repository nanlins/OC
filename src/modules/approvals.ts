/**
 * modules/approvals.ts —— 人工审批流模块
 *
 * 职责：pickApprover 偏好链（scoped admins → global admins → owners）；requestApproval 建
 *       pending_approvals 行 + 投递审批卡；resolveApproval（approve/reject）+ 回放经
 *       reenterGuardedDeliveryAction；reason 捕获简化为 CLI 文本行。
 * 关键导出：listOwners, pickApprover, requestApproval, resolveApproval, getPendingApproval
 * 承重不变量：审批行 resolve 即删（grant 恰好执行一次）；grant 只满足 hold 永不松动 deny（guard 层）。
 * 借鉴：nanoclaw src/modules/approvals/{primitive,response-handler}.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 *   2026-08-12 复检修复：先回放后删行（恰好一次）；注册 grant 活行复核器（查库验 pending）
 *   2026-08-13 阶段 14：审批卡 options_json 按宿主 locale 本地化
 */
import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import { reenterGuardedDeliveryAction } from "../delivery.js";
import { setGrantLiveValidator } from "../guard/guard.js";
import { log } from "../log.js";
import { t, resolveLocaleFromEnv } from "../i18n/index.js";
import type { PendingApproval, Session } from "../types.js";

// grant 活行复核：guard 回放前查库验 pending（伪造内存对象不得通过）
setGrantLiveValidator((grant) => getPendingApproval(grant.id) !== undefined);

export function listOwners(): string[] {
  const rows = getDb()
    .prepare("SELECT user_id FROM user_roles WHERE role = 'owner' AND agent_group_id IS NULL")
    .all() as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

/** 审批人偏好链：scoped admins → global admins → owners */
export function pickApprover(agentGroupId: string | null): string[] {
  const scoped = getDb()
    .prepare("SELECT user_id FROM user_roles WHERE role = 'admin' AND agent_group_id = ?")
    .all(agentGroupId) as Array<{ user_id: string }>;
  const globalAdmins = getDb()
    .prepare("SELECT user_id FROM user_roles WHERE role = 'admin' AND agent_group_id IS NULL")
    .all() as Array<{ user_id: string }>;
  const seen = new Set<string>();
  return [...scoped.map((r) => r.user_id), ...globalAdmins.map((r) => r.user_id), ...listOwners()].filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

export function createPendingApproval(opts: {
  sessionId: string;
  action: string;
  agentGroupId?: string | null;
  payload?: unknown;
  title?: string;
  approverUserId?: string | null;
}): PendingApproval {
  const row: PendingApproval = {
    id: randomUUID(),
    session_id: opts.sessionId,
    action: opts.action,
    payload: JSON.stringify(opts.payload ?? {}),
    user_id: null,
    approver_user_id: opts.approverUserId ?? null,
    agent_group_id: opts.agentGroupId ?? null,
    status: "pending",
    title: opts.title ?? null,
    options_json: JSON.stringify([
      t("common.approve", resolveLocaleFromEnv()),
      t("common.reject", resolveLocaleFromEnv()),
    ]),
    question: opts.title ?? null,
    created_at: new Date().toISOString(),
    resolved_at: null,
  };
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO pending_approvals
       (id, session_id, action, payload, user_id, approver_user_id, agent_group_id, status, title, options_json, question, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.session_id,
      row.action,
      row.payload,
      row.user_id,
      row.approver_user_id,
      row.agent_group_id,
      row.status,
      row.title,
      row.options_json,
      row.question,
      row.created_at,
      row.resolved_at,
    );
  return row;
}

export function getPendingApproval(id: string): PendingApproval | undefined {
  return getDb().prepare("SELECT * FROM pending_approvals WHERE id = ? AND status = 'pending'").get(id) as
    PendingApproval | undefined;
}

/** 请求审批：建行 + 投递审批卡（CLI 广播 JSON 卡）；返回审批 id */
export async function requestApproval(opts: {
  sessionId: string;
  action: string;
  agentGroupId?: string | null;
  payload?: unknown;
  title: string;
}): Promise<string> {
  const approvers = pickApprover(opts.agentGroupId ?? null);
  const row = createPendingApproval({
    sessionId: opts.sessionId,
    action: opts.action,
    agentGroupId: opts.agentGroupId,
    payload: opts.payload,
    title: opts.title,
    approverUserId: approvers[0] ?? null,
  });
  const { getChannelAdapterExact } = await import("../channels/channel-registry.js");
  const adapter = getChannelAdapterExact("cli");
  await adapter?.deliver("local", null, {
    kind: "system",
    content: JSON.stringify({ type: "approval_card", approval_id: row.id, action: opts.action, title: opts.title }),
  });
  log.info(`approval requested: ${row.id} (${opts.action}) approvers=${approvers.length}`);
  return row.id;
}

/** 解决审批：approve → 先回放（guard 查库验活行）成功后再删行（恰好一次，阶段 6 复检 P1 修复）；
 *  reject → 直接删行。回放失败则审批保留，可重试。 */
export async function resolveApproval(
  approvalId: string,
  decision: "approve" | "reject",
  out: {
    content: string;
    kind: string;
    operation?: string | null;
    platform_id?: string | null;
    channel_type?: string | null;
    thread_id?: string | null;
  },
  sessionForReplay: Session,
): Promise<boolean> {
  const row = getPendingApproval(approvalId);
  if (!row) return false;
  if (decision === "reject") {
    getDb().prepare("DELETE FROM pending_approvals WHERE id = ?").run(approvalId);
    log.info(`approval rejected: ${approvalId}`);
    return true;
  }
  const reenter = reenterGuardedDeliveryAction(row.action);
  await reenter(out as never, sessionForReplay, row); // 失败抛错 → 不删行
  getDb().prepare("DELETE FROM pending_approvals WHERE id = ?").run(approvalId);
  log.info(`approval approved & replayed: ${approvalId} (${row.action})`);
  return true;
}
