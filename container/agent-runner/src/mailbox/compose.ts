/**
 * mailbox/compose.ts —— 批次组装
 *
 * 职责：把原始待处理行组装成 MailboxBatch（消息 + 批路由）。批路由取最后一条消息的
 * platform/channel/thread（与 poll-loop 的 extractRouting 语义一致）。
 * 借鉴：nanoclaw container/agent-runner/src/mailbox/compose.ts
 *
 * 修改记录：2026-10-06 创建（P0-1：mailbox 抽象层）
 */
import { getSessionRouting } from "../db/session-routing.ts";
import type { MailboxBatch, MailboxMessage } from "./types.ts";

export function composeBatch(messages: MailboxMessage[]): MailboxBatch {
  const last = messages[messages.length - 1] ?? null;
  return {
    messages,
    routing: {
      platformId: last?.platform_id ?? null,
      channelType: last?.channel_type ?? null,
      threadId: last?.thread_id ?? null,
    },
  };
}

export interface MailboxContext {
  routing: ReturnType<typeof getSessionRouting>;
  batchCount: number;
}

/** 读取当前邮箱上下文：会话路由（inbound 单行表）+ 最近批次计数占位。 */
export function readMailboxContext(): MailboxContext {
  return { routing: getSessionRouting(), batchCount: 0 };
}
