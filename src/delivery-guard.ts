/**
 * delivery-guard.ts —— 特权投递动作的守卫咨询管线
 *
 * 职责：DeliveryGuardSpec + runGuarded：precheck → guard() → deny/hold/allow 分派。
 * 关键导出：DeliveryGuardSpec, GuardedDeliveryHandler, runGuarded
 * 承重不变量：guard-wrapped 动作拒绝被 unguarded 重注册（delivery.ts 强制）；
 *           grant 回放经 guard() 结构检查重跑（批准后撤销不执行）。
 * 借鉴：nanoclaw src/delivery-guard.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 5）
 */
import { guard, isUnguarded, type GuardedAction, type Unguarded } from "./guard/index.js";
import { log } from "./log.js";
import type { MessageOut, PendingApproval, Session } from "./types.js";

export type GuardedDeliveryHandler = (out: MessageOut, session: Session) => Promise<void>;

/** 审计 sink（observability 模块注册；全程留痕，知识文档 04 §4.11） */
export interface AuditEntry {
  action: string;
  actor: string;
  decision: string;
  reason: string;
}
type AuditSink = (entry: AuditEntry) => void;
let auditSink: AuditSink | null = null;
export function setAuditSink(sink: AuditSink): void {
  auditSink = sink;
}
function audit(action: GuardedAction, entry: Omit<AuditEntry, "action">): void {
  try {
    auditSink?.({ action: action.name, ...entry });
  } catch {
    /* 审计不得影响主流程 */
  }
}

export interface DeliveryGuardSpec {
  guardAction: GuardedAction;
  /** 领域校验：返回错误消息则不创建 hold，直接通知 */
  precheck?: (out: MessageOut, session: Session) => string | null;
  /** hold 时由领域侧发审批卡 */
  requestHold?: (out: MessageOut, session: Session, reason: string, approverUserId?: string) => Promise<void>;
  /** deny 时通知请求方 */
  onDeny?: (out: MessageOut, session: Session, reason: string) => Promise<void>;
}

export type DeliveryActionRegistration =
  { guard: DeliveryGuardSpec; handler: GuardedDeliveryHandler } | { guard: Unguarded; handler: GuardedDeliveryHandler };

/**
 * 守卫咨询管线。grant 存在时经 guard() 满足 hold（批准回放）。
 */
export async function runGuarded(
  spec: DeliveryGuardSpec,
  handler: GuardedDeliveryHandler,
  out: MessageOut,
  session: Session,
  grant?: PendingApproval,
): Promise<void> {
  if (spec.precheck) {
    const err = spec.precheck(out, session);
    if (err) {
      log.warn(`delivery precheck failed: ${err}`);
      await spec.onDeny?.(out, session, err);
      return;
    }
  }
  const decision = guard(spec.guardAction, { actor: "agent", payload: out.content, grant });
  if (decision.kind === "deny") {
    log.warn(`delivery denied: ${decision.reason}`);
    audit(spec.guardAction, { actor: "agent", decision: "deny", reason: decision.reason });
    await spec.onDeny?.(out, session, decision.reason);
    return;
  }
  if (decision.kind === "hold") {
    // P1-4 修复：hold 无法落地（无 requestHold）时抛错走 retry/failed，绝不静默误标 delivered
    if (!spec.requestHold) {
      throw new Error(`guarded action held but no requestHold provided: ${decision.reason}`);
    }
    log.info(`delivery held for approval: ${decision.reason}`);
    audit(spec.guardAction, { actor: "agent", decision: "hold", reason: decision.reason });
    await spec.requestHold(out, session, decision.reason, decision.approverUserId);
    return;
  }
  audit(spec.guardAction, { actor: "agent", decision: "allow", reason: decision.reason });
  await handler(out, session);
}

export { isUnguarded };
