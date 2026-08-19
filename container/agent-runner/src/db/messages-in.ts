/**
 * db/messages-in.ts —— 入站消息读取 + ack 写入（容器从不写 messages_in 本体）
 *
 * 职责：getPendingMessages（on_wake 仅首轮/process_after 到期/DESC 取最新反转）；
 *       markProcessing/markCompleted/markFailed（写 outbound 的 processing_ack）。
 * 关键导出：getPendingMessages, markProcessing, markCompleted, markFailed, MessageInRow
 * 承重不变量：状态确认走 outbound 的 processing_ack。
 * 借鉴：nanoclaw container/agent-runner/src/db/messages-in.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 修复：getPendingMessages 容器侧排除已 ack 消息（防 60s sweep 窗口内重复处理）
 *   2026-08-12 ai-inspector 修复：轮询排除 kind=system（防应答双消费）
 */
import { openInboundPoll, getOutboundDb, runNamed, allNamed } from "./connection.ts";

export interface MessageInRow {
  id: string;
  seq: number;
  kind: string;
  timestamp: string;
  status: string;
  process_after: string | null;
  recurrence: string | null;
  series_id: string | null;
  tries: number;
  trigger: number;
  on_wake: number;
  platform_id: string | null;
  channel_type: string | null;
  thread_id: string | null;
  content: string;
  source_session_id: string | null;
}

export function getPendingMessages(opts: { isFirstPoll: boolean; max?: number; nowIso: string }): MessageInRow[] {
  const db = openInboundPoll();
  try {
    const max = opts.max ?? 20;
    const sql = `
      SELECT * FROM messages_in
      WHERE status = 'pending'
        AND kind NOT IN ('system', 'question_response')
        AND (process_after IS NULL OR process_after <= $now)
        AND ($firstPoll = 1 OR on_wake = 0)
      ORDER BY seq DESC
      LIMIT $max
    `;
    const rows = allNamed<MessageInRow>(db.prepare(sql), {
      $now: opts.nowIso,
      $firstPoll: opts.isFirstPoll ? 1 : 0,
      $max: max,
    });
    // 容器侧排除已 ack 的消息（messages_in.status 由宿主 sweep 同步，60s 窗口内容器自排，防重复处理）
    const acked = new Set(
      (getOutboundDb().prepare("SELECT message_id FROM processing_ack").all() as Array<{ message_id: string }>).map(
        (r) => r.message_id,
      ),
    );
    return rows.reverse().filter((r) => !acked.has(r.id));
  } finally {
    db.close();
  }
}

export function markProcessing(ids: string[]): void {
  const db = getOutboundDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO processing_ack (message_id, status, status_changed) VALUES ($id, 'processing', $now)
     ON CONFLICT (message_id) DO UPDATE SET status='processing', status_changed=$now`,
  );
  for (const id of ids) runNamed(stmt, { $id: id, $now: now });
}

export function markCompleted(ids: string[]): void {
  writeAcks(ids, "completed");
}

export function markFailed(ids: string[]): void {
  writeAcks(ids, "failed");
}

function writeAcks(ids: string[], status: string): void {
  const db = getOutboundDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO processing_ack (message_id, status, status_changed) VALUES ($id, $status, $now)
     ON CONFLICT (message_id) DO UPDATE SET status=$status, status_changed=$now`,
  );
  for (const id of ids) runNamed(stmt, { $id: id, $status: status, $now: now });
}
