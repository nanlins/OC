/**
 * modules/scheduling.ts —— 定时任务模块（宿主侧）
 *
 * 职责：schedule_task/cancel_task 系统动作消费；任务=消息行（kind='task'，thread_id=system:tasks:<series>）；
 *       handleRecurrence：completed/failed + recurrence → 计算下次触发写入新行（cron 按组时区）；
 *       连败退避 2*2^n min 60；24h > 4 次且无 script 拒绝（MAX_DAILY_FIRES）。
 * 关键导出：handleRecurrence, MAX_DAILY_FIRES
 * 承重不变量：任务行与聊天行同库同管线；recurrence 在 sweep 中于 GC 之前执行。
 * 借鉴：nanoclaw src/modules/scheduling/
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 *   2026-08-12 复检修复：限频改预测式（未来24h cron 推演）；连败≥8 写 paused 可恢复行（防 GC 销毁）；armed 检查含 paused
 */
import { CronExpressionParser } from "cron-parser";
import { randomUUID } from "node:crypto";
import { registerDeliveryAction } from "../delivery.js";
import { unguarded } from "../guard/index.js";
import { resolveSession, writeSessionMessage, inboundDbPath } from "../session-manager.js";
import { openInboundDb } from "../db/session-db.js";
import { taskThreadId } from "../db/sessions.js";
import { resolveGroupTimezone } from "../container-config.js";
import { log } from "../log.js";
import type { MessageOut, Session } from "../types.js";

export const MAX_DAILY_FIRES = 4;

function validateCron(cron: string, tz: string): string | null {
  try {
    CronExpressionParser.parse(cron, { tz });
    return null;
  } catch (err) {
    return `invalid cron: ${String(err)}`;
  }
}

function nextCronIso(cron: string, tz: string, from: Date): string {
  const it = CronExpressionParser.parse(cron, { tz, currentDate: from });
  return it.next().toDate().toISOString();
}

/** 预测式限频：未来 24h 内 cron 触发次数（基线 create.ts:83-101 语义） */
function countFiresIn24h(cron: string, tz: string): number {
  const it = CronExpressionParser.parse(cron, { tz, currentDate: new Date() });
  const limit = Date.now() + 24 * 3600 * 1000;
  let n = 0;
  for (const item of it) {
    if (item.toDate().getTime() > limit) break;
    n += 1;
    if (n > 1000) break;
  }
  return n;
}

/**
 * 阶段 12（tasks 全 CRUD 补齐）：共享任务创建内核。
 * 由 schedule_task 投递动作与 oc tasks create 命令共同调用；校验/限频/写任务行三合一。
 */
export function createTaskInternal(
  agentGroupId: string,
  opts: { message?: string; cron?: string | null; processAfter?: string | null },
): { seriesId: string; next?: string } {
  const tz = resolveGroupTimezone(agentGroupId);
  const seriesId = randomUUID();
  const taskSession = resolveSession({
    agentGroupId,
    messagingGroupId: null,
    threadId: taskThreadId(seriesId),
    sessionMode: "per-thread",
  });
  const inbound = openInboundDb(inboundDbPath(taskSession.agent_group_id, taskSession.id));
  try {
    if (opts.cron) {
      const err = validateCron(opts.cron, tz);
      if (err) throw new Error(err);
      // P1 修复（ai-inspector）：预测式限频——向未来模拟 24h 触发次数，>MAX_DAILY_FIRES 拒绝
      if (countFiresIn24h(opts.cron, tz) > MAX_DAILY_FIRES) {
        throw new Error(
          "recurrence limit exceeded (>4 fires/day predicted); add a pre-task script gate or use a coarser cron",
        );
      }
      const next = nextCronIso(opts.cron, tz, new Date());
      writeSessionMessage(taskSession, {
        id: randomUUID(),
        kind: "task",
        content: opts.message ?? "",
        recurrence: opts.cron,
        seriesId,
        processAfter: next,
        trigger: 1,
      });
      return { seriesId, next };
    }
    if (opts.processAfter) {
      writeSessionMessage(taskSession, {
        id: randomUUID(),
        kind: "task",
        content: opts.message ?? "",
        seriesId,
        processAfter: opts.processAfter,
        trigger: 1,
      });
      return { seriesId, next: opts.processAfter };
    }
    throw new Error("schedule_task requires cron or process_after");
  } finally {
    inbound.close();
  }
}

registerDeliveryAction("schedule_task", {
  guard: unguarded("agent scheduling is rate-limited, not approval-gated"),
  handler: async (out: MessageOut, session: Session) => {
    const parsed = JSON.parse(out.content) as { message?: string; cron?: string | null; process_after?: string | null };
    // 阶段 12：复用共享创建内核（与 oc tasks create 同源）
    createTaskInternal(session.agent_group_id, {
      message: parsed.message,
      cron: parsed.cron,
      processAfter: parsed.process_after,
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

import { listSessions } from "../db/sessions.js";

function listTaskSessions(agentGroupId: string): Session[] {
  return listSessions().filter(
    (s) => s.agent_group_id === agentGroupId && (s.thread_id ?? "").startsWith("system:tasks:"),
  );
}

/** 循环任务扇出（host-sweep 每 tick 调用）：completed/failed + recurrence → 下次触发；连败退避 */
export function handleRecurrence(session: Session): void {
  const inbound = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
  try {
    const done = inbound
      .prepare(
        `SELECT id, series_id, content, recurrence, status FROM messages_in
         WHERE kind = 'task' AND recurrence IS NOT NULL AND status IN ('completed', 'failed')`,
      )
      .all() as Array<{ id: string; series_id: string | null; content: string; recurrence: string; status: string }>;
    for (const row of done) {
      // 已有同 series 的 pending/processing/paused 行 → 已 re-arm 或已暂停，跳过
      const armed = inbound
        .prepare(
          "SELECT 1 AS x FROM messages_in WHERE kind = 'task' AND series_id = ? AND status IN ('pending', 'processing', 'paused')",
        )
        .get(row.series_id ?? row.id);
      if (armed) continue;
      const tz = resolveGroupTimezone(session.agent_group_id);
      let nextIso: string;
      try {
        nextIso = nextCronIso(row.recurrence, tz, new Date());
      } catch {
        continue;
      }
      // 连败退避：尾部连续 failed 计数 → 2*2^n min 60 分钟；≥8 连败写 paused 行（可恢复，防 GC 销毁，P0 修复）
      const trailing = trailingFailed(inbound, row.series_id ?? row.id);
      if (trailing >= 8) {
        log.warn(`task series auto-paused after ${trailing} consecutive failures: ${row.series_id}`);
        const pausedId = writeSessionMessage(session, {
          id: randomUUID(),
          kind: "task",
          content: row.content,
          recurrence: row.recurrence,
          seriesId: row.series_id ?? row.id,
          processAfter: "9999-01-01T00:00:00Z",
          trigger: 0,
        });
        inbound.prepare("UPDATE messages_in SET status = 'paused' WHERE id = ?").run(pausedId);
        continue;
      }
      if (trailing > 0 && row.status === "failed") {
        const backoffMin = Math.min(2 * 2 ** trailing, 60);
        const backoffIso = new Date(Date.now() + backoffMin * 60000).toISOString();
        if (backoffIso > nextIso) nextIso = backoffIso;
      }
      writeSessionMessage(session, {
        id: randomUUID(),
        kind: "task",
        content: row.content,
        recurrence: row.recurrence,
        seriesId: row.series_id ?? row.id,
        processAfter: nextIso,
        trigger: 1,
      });
    }
  } finally {
    inbound.close();
  }
}

function trailingFailed(inbound: ReturnType<typeof openInboundDb>, seriesId: string): number {
  const rows = inbound
    .prepare("SELECT status FROM messages_in WHERE kind = 'task' AND series_id = ? ORDER BY seq DESC LIMIT 12")
    .all(seriesId) as Array<{ status: string }>;
  let n = 0;
  for (const r of rows) {
    if (r.status === "failed") n += 1;
    else break;
  }
  return n;
}
