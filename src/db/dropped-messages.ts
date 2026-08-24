/**
 * db/dropped-messages.ts —— 丢弃消息审计
 *
 * 职责：记录被路由丢弃的消息（agent 未绑定/wiring 不匹配/权限拒绝），
 *       支持按 messaging_group 查询。宿主可审计哪些消息被静默丢弃。
 * 关键导出：recordDroppedMessage, listDroppedMessages, getDroppedMessageCount
 * 借鉴：nanoclaw src/db/ 的 dropped-messages 模式
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { getDb } from "./connection.js";

export interface DroppedMessageRow {
  messaging_group_id: string;
  sender_id: string | null;
  display_name: string | null;
  reason: string;
  content_preview: string;
  dropped_at: string;
}

export function recordDroppedMessage(row: DroppedMessageRow): void {
  getDb()
    .prepare(
      `INSERT INTO unregistered_senders (messaging_group_id, sender_id, display_name, message_count, last_seen)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(messaging_group_id, sender_id) DO UPDATE SET
         message_count = message_count + 1,
         last_seen = excluded.last_seen`,
    )
    .run(row.messaging_group_id, row.sender_id, row.display_name, row.dropped_at);
}

export function listDroppedMessages(limit = 50): Array<Record<string, unknown>> {
  return getDb().prepare("SELECT * FROM unregistered_senders ORDER BY last_seen DESC LIMIT ?").all(limit) as Array<
    Record<string, unknown>
  >;
}

export function getDroppedMessageCount(groupId: string): number {
  const row = getDb()
    .prepare("SELECT SUM(message_count) as cnt FROM unregistered_senders WHERE messaging_group_id = ?")
    .get(groupId) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */
