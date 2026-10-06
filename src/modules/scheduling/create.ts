/**
 * modules/scheduling/create.ts —— 任务创建内核
 *
 * 职责：validateCron / nextCronIso / countFiresIn24h（预测式限频）/ createTaskInternal。
 *       createTaskInternal 由 schedule_task 投递动作与 oc tasks create 命令共同调用；
 *       任务内容经 task-content.ts 的信封（script/originSessionId 可携带）。
 * 关键导出：createTaskInternal, MAX_DAILY_FIRES
 * 借鉴：nanoclaw src/modules/scheduling/create.ts
 *
 * 修改记录：
 *   2026-10-06 P0-3：从 modules/scheduling.ts 拆出；任务内容改走信封
 */
import { CronExpressionParser } from "cron-parser";
import { randomUUID } from "node:crypto";
import { resolveSession, writeSessionMessage, inboundDbPath } from "../../session-manager.js";
import { openInboundDb } from "../../db/session-db.js";
import { taskThreadId } from "../../db/sessions.js";
import { resolveGroupTimezone } from "../../container-config.js";
import { composeTaskContent } from "./task-content.js";

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
 * 共享任务创建内核（阶段 12 + P0-3 信封扩展）。
 * 由 schedule_task 投递动作与 oc tasks create 命令共同调用；校验/限频/写任务行三合一。
 * opts.script / opts.originSessionId 会编入内容信封（旧容器读纯字符串 prompt 仍兼容）。
 */
export function createTaskInternal(
  agentGroupId: string,
  opts: {
    message?: string;
    cron?: string | null;
    processAfter?: string | null;
    script?: string | null;
    originSessionId?: string | null;
  },
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
    const content = composeTaskContent({
      prompt: opts.message ?? "",
      script: opts.script ?? null,
      originSessionId: opts.originSessionId ?? null,
    });
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
        content,
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
        content,
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
