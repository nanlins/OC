/**
 * modules/scheduling/index.ts —— 定时任务模块（宿主侧）
 *
 * 职责：schedule_task/cancel_task 系统动作消费；再导出创建/扇出/信封/运行日志。
 *       任务=消息行（kind='task'，thread_id=system:tasks:<series>）；任务内容走信封
 *       {prompt, script, originSessionId}（task-content.ts）。
 * 关键导出：createTaskInternal, handleRecurrence, MAX_DAILY_FIRES（副作用注册投递动作）
 * 借鉴：nanoclaw src/modules/scheduling/
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6，单文件形态）
 *   2026-10-06 P0-3：按职责拆为 create/recurrence/task-content/run-log + 本桶
 */
import { registerDeliveryAction } from "../../delivery.js";
import { unguarded } from "../../guard/index.js";
import { listSessions } from "../../db/sessions.js";
import { inboundDbPath } from "../../session-manager.js";
import { openInboundDb } from "../../db/session-db.js";
import { log } from "../../log.js";
import { createTaskInternal } from "./create.js";
import type { MessageOut, Session } from "../../types.js";

export { createTaskInternal, MAX_DAILY_FIRES } from "./create.js";
export { handleRecurrence } from "./recurrence.js";
export { parseTaskContent, composeTaskContent, type TaskEnvelope } from "./task-content.js";
export { appendRunLog, appendHostTaskNote } from "./run-log.js";

registerDeliveryAction("schedule_task", {
  guard: unguarded("agent scheduling is rate-limited, not approval-gated"),
  handler: async (out: MessageOut, session: Session) => {
    const parsed = JSON.parse(out.content) as {
      message?: string;
      cron?: string | null;
      process_after?: string | null;
      script?: string | null;
      origin_session_id?: string | null;
    };
    // 阶段 12：复用共享创建内核（与 oc tasks create 同源）；P0-3：script 进信封
    createTaskInternal(session.agent_group_id, {
      message: parsed.message,
      cron: parsed.cron,
      processAfter: parsed.process_after,
      script: parsed.script ?? null,
      originSessionId: parsed.origin_session_id ?? null,
    });
    log.info(`task scheduled`);
  },
});

registerDeliveryAction("cancel_task", {
  guard: unguarded("agent may cancel its own tasks"),
  handler: async (out: MessageOut, session: Session) => {
    const { task_id } = JSON.parse(out.content) as { task_id?: string };
    if (!task_id) return;
    // 任务会话按 thread 前缀扫：将该 series 的 pending 行置 cancelled
    for (const s of listTaskSessions(session.agent_group_id)) {
      const inbound = openInboundDb(inboundDbPath(s.agent_group_id, s.id));
      try {
        inbound
          .prepare(
            "UPDATE messages_in SET status = 'cancelled', recurrence = NULL WHERE kind = 'task' AND status = 'pending' AND (series_id = ? OR id = ?)",
          )
          .run(task_id, task_id);
      } finally {
        inbound.close();
      }
    }
    log.info(`task cancel requested: ${task_id}`);
  },
});

function listTaskSessions(agentGroupId: string): Session[] {
  return listSessions().filter(
    (s) => s.agent_group_id === agentGroupId && (s.thread_id ?? "").startsWith("system:tasks:"),
  );
}
