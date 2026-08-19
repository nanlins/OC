/**
 * db/messages-out.ts —— 出站消息写入（容器单写者，奇数 seq）
 *
 * 职责：writeMessageOut（奇数 seq 车道）、getRoutingBySeq。
 * 关键导出：writeMessageOut, getRoutingBySeq, nextOddSeq, WriteMessageOut
 * 承重不变量：容器奇数 / 主机偶数 seq 车道隔离。
 * 借鉴：nanoclaw container/agent-runner/src/db/messages-out.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import { getOutboundDb, openInboundLongLived, runNamed } from "./connection.ts";

export interface WriteMessageOut {
  id: string;
  kind: string;
  content: string;
  /** 交互操作语义：edit/reaction（docs/07：交互操作走 messages_out operation 字段） */
  operation?: string | null;
  inReplyTo?: string | null;
  deliverAfter?: string | null;
  recurrence?: string | null;
  platformId?: string | null;
  channelType?: string | null;
  threadId?: string | null;
}

/** 奇数 seq 发号：MAX 为偶则 +1，为奇则 +2 */
export function nextOddSeq(db: ReturnType<typeof getOutboundDb>): number {
  const row = db.prepare("SELECT MAX(seq) AS m FROM messages_out").get() as { m: number | null };
  const max = row.m ?? 0;
  return max % 2 === 0 ? max + 1 : max + 2;
}

export function writeMessageOut(msg: WriteMessageOut): number {
  const db = getOutboundDb();
  const seq = nextOddSeq(db);
  runNamed(
    db.prepare(
      `INSERT INTO messages_out (id, seq, in_reply_to, timestamp, deliver_after, recurrence, kind, operation, platform_id, channel_type, thread_id, content)
       VALUES ($id, $seq, $inReplyTo, $now, $deliverAfter, $recurrence, $kind, $operation, $platformId, $channelType, $threadId, $content)`,
    ),
    {
      $id: msg.id,
      $seq: seq,
      $inReplyTo: msg.inReplyTo ?? null,
      $now: new Date().toISOString(),
      $deliverAfter: msg.deliverAfter ?? null,
      $recurrence: msg.recurrence ?? null,
      $kind: msg.kind,
      $operation: msg.operation ?? null,
      $platformId: msg.platformId ?? null,
      $channelType: msg.channelType ?? null,
      $threadId: msg.threadId ?? null,
      $content: msg.content,
    },
  );
  return seq;
}

/** seq → 路由元组（入站 id 即平台 id；出站查 delivered 的 platform_message_id） */
export function getRoutingBySeq(
  seq: number,
): { platformId: string | null; channelType: string | null; threadId: string | null } | null {
  const inbound = openInboundLongLived();
  try {
    const inRow = inbound
      .prepare("SELECT platform_id, channel_type, thread_id FROM messages_in WHERE seq = ?")
      .get(seq) as { platform_id: string | null; channel_type: string | null; thread_id: string | null } | undefined;
    if (inRow) {
      return { platformId: inRow.platform_id, channelType: inRow.channel_type, threadId: inRow.thread_id };
    }
    const db = getOutboundDb();
    const outRow = db.prepare("SELECT id FROM messages_out WHERE seq = ?").get(seq) as { id: string } | undefined;
    if (!outRow) return null;
    const delivered = inbound
      .prepare("SELECT platform_message_id FROM delivered WHERE message_out_id = ?")
      .get(outRow.id) as { platform_message_id: string | null } | undefined;
    return { platformId: delivered?.platform_message_id ?? outRow.id, channelType: null, threadId: null };
  } finally {
    inbound.close();
  }
}
