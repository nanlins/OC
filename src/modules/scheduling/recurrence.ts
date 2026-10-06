/**
 * modules/scheduling/recurrence.ts —— 循环任务扇出
 *
 * 职责：handleRecurrence（completed/failed + recurrence → 原子 re-arm；连败退避；
 *       ≥8 连败写 paused 可恢复行）+ trailingFailed。
 * 承重不变量：re-arm 经 armTaskAtomically（单语句条件插入）——"检查已有 armed 行 + 插入"
 *       在同一 SQL 语句内，无竞态窗口（P0-1）。
 * 借鉴：nanoclaw src/modules/scheduling/recurrence.ts
 *
 * 修改记录：
 *   2026-10-06 P0-3：从 modules/scheduling.ts 拆出；P0-1 原子 re-arm 保留
 */
import { randomUUID } from "node:crypto";
import { CronExpressionParser } from "cron-parser";
import { inboundDbPath } from "../../session-manager.js";
import { openInboundDb, armTaskAtomically } from "../../db/session-db.js";
import { touchSession } from "../../db/sessions.js";
import { resolveGroupTimezone } from "../../container-config.js";
import { log } from "../../log.js";
import { appendHostTaskNote } from "./run-log.js";
import type { Session } from "../../types.js";

function nextCronIso(cron: string, tz: string, from: Date): string {
  const it = CronExpressionParser.parse(cron, { tz, currentDate: from });
  return it.next().toDate().toISOString();
}

/** 循环任务扇出（host-sweep 每 tick 调用）：completed/failed + recurrence → 下次触发；连败退避。
 *  P0-1：re-arm 改为原子条件插入（armTaskAtomically）——旧实现"SELECT 判断已有 armed 行 +
 *  writeSessionMessage 再 insert"存在竞态窗口：两个并发 sweep 可同时通过判断、双双插入，
 *  同 series 双触发。现在"检查 + 插入"在同一 SQL 语句内完成。 */
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
      const seriesId = row.series_id ?? row.id;
      const tz = resolveGroupTimezone(session.agent_group_id);
      let nextIso: string;
      try {
        nextIso = nextCronIso(row.recurrence, tz, new Date());
      } catch {
        continue;
      }
      // 连败退避：尾部连续 failed 计数 → 2*2^n min 60 分钟；≥8 连败写 paused 行（可恢复，防 GC 销毁，P0 修复）
      const trailing = trailingFailed(inbound, seriesId);
      if (trailing >= 8) {
        const armed = armTaskAtomically(inbound, {
          id: randomUUID(),
          kind: "task",
          content: row.content,
          recurrence: row.recurrence,
          seriesId,
          processAfter: "9999-01-01T00:00:00Z",
          trigger: 0,
          taskStatus: "paused",
        });
        if (armed) {
          log.warn(`task series auto-paused after ${trailing} consecutive failures: ${seriesId}`);
          appendHostTaskNote(session.agent_group_id, seriesId, `auto-paused after ${trailing} consecutive failures`);
          touchSession(session.id);
        }
        continue;
      }
      if (trailing > 0 && row.status === "failed") {
        const backoffMin = Math.min(2 * 2 ** trailing, 60);
        const backoffIso = new Date(Date.now() + backoffMin * 60000).toISOString();
        if (backoffIso > nextIso) nextIso = backoffIso;
        appendHostTaskNote(session.agent_group_id, seriesId, `backoff: next fire delayed to ${nextIso}`);
      }
      const armed = armTaskAtomically(inbound, {
        id: randomUUID(),
        kind: "task",
        content: row.content,
        recurrence: row.recurrence,
        seriesId,
        processAfter: nextIso,
        trigger: 1,
      });
      if (armed) touchSession(session.id);
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
