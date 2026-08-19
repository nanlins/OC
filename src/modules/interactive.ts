/**
 * modules/interactive.ts —— 交互式问题模块（宿主侧）
 *
 * 职责：ask_question 系统动作 → 投递选项卡 + 建 question_routes 精确路由行；
 *       messageInterceptor 捕获 CLI 应答行 {answer_to, text}：发送者权限校验 + questionId 存在性校验 →
 *       写 kind='question_response' 系统行（带 userId）到提问会话 + wakeContainer + 删路由行。
 * 关键导出：无（副作用注册）
 * 承重不变量：拦截器内做门控（阶段 6 复检 P1-2 修复：不得绕过访问门控写会话）；
 *           应答走专用 kind，容器精确等值匹配（禁 JSON LIKE）。
 * 借鉴：nanoclaw src/modules/interactive/（question_routes 表精确路由）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 *   2026-08-12 复检修复：question_routes 精确路由 + 发送者门控 + userId 落库 + wake + 专用 kind
 */
import { randomUUID } from "node:crypto";
import { registerDeliveryAction } from "../delivery.js";
import { unguarded } from "../guard/index.js";
import { registerMessageInterceptor } from "../router.js";
import { getChannelAdapterExact } from "../channels/channel-registry.js";
import { getDb } from "../db/connection.js";
import { registerMigration } from "../db/migrations/index.js";
import { upsertUser, canAccessAgentGroup } from "../db/users.js";
import { writeSessionMessage } from "../session-manager.js";
import { wakeContainer } from "../container-runner.js";
import { log } from "../log.js";
import type { MessageOut, Session } from "../types.js";

registerMigration({
  version: 903,
  name: "module:interactive:question-routes",
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS question_routes (
        question_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_group_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

registerDeliveryAction("ask_question", {
  guard: unguarded("asking the user is never privileged"),
  handler: async (out: MessageOut, session: Session) => {
    const parsed = JSON.parse(out.content) as { questionId?: string };
    if (parsed.questionId) {
      getDb()
        .prepare(
          `INSERT OR IGNORE INTO question_routes (question_id, session_id, agent_group_id, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(parsed.questionId, session.id, session.agent_group_id, new Date().toISOString());
    }
    const adapter = getChannelAdapterExact(out.channel_type ?? "cli");
    if (!adapter) throw new Error("ask_question: no adapter for delivery");
    await adapter.deliver(out.platform_id ?? "local", out.thread_id ?? null, {
      kind: "system",
      content: out.content,
      type: "ask_question",
    });
  },
});

// CLI 应答拦截：{"answer_to":"<questionId>","text":"..."} → 精确路由 + 门控 + 写 question_response + wake
registerMessageInterceptor(async (event) => {
  let parsed: { answer_to?: string; text?: string } | null = null;
  try {
    parsed = JSON.parse(event.message.content) as { answer_to?: string; text?: string };
  } catch {
    return false;
  }
  if (!parsed || !parsed.answer_to || !UUID_RE.test(parsed.answer_to)) return false;
  const route = getDb()
    .prepare("SELECT session_id, agent_group_id FROM question_routes WHERE question_id = ?")
    .get(parsed.answer_to) as { session_id: string; agent_group_id: string } | undefined;
  if (!route) return false;
  // 发送者门控（复检 P1-2）：陌生人不允许注入"用户应答"
  const senderId = event.message.senderId ?? null;
  if (!senderId) return true; // 吞掉但拒绝写入（防路由泄露）
  const user = upsertUser(senderId, event.channelType, event.message.senderName ?? undefined);
  const decision = canAccessAgentGroup(user.id, route.agent_group_id);
  if (decision.kind === "not_member" || decision.kind === "unknown_user") {
    log.warn(`question answer rejected: sender not authorized ${senderId}`);
    return true;
  }
  const { getSession } = await import("../db/sessions.js");
  const target = getSession(route.session_id);
  if (!target) return true;
  writeSessionMessage(target, {
    id: randomUUID(),
    kind: "question_response",
    content: JSON.stringify({ questionId: parsed.answer_to, answer: parsed.text ?? "", userId: user.id }),
    trigger: 0,
  });
  getDb().prepare("DELETE FROM question_routes WHERE question_id = ?").run(parsed.answer_to);
  await wakeContainer(target);
  log.info(`question answered: ${parsed.answer_to} by ${user.id}`);
  return true;
});
