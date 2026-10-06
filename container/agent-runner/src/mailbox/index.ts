/**
 * mailbox/index.ts —— mailbox 门面
 *
 * 职责：getAgentMailbox() / withMailboxSession() / readMailboxContext() /
 *       mailbox.run(action)。MCP 工具与 poll-loop 的统一执行入口：
 *       不再各自直接 import db/* 裸 SQL，而是经邮箱会话拿操作面。
 *
 * 承重不变量（为什么会话边界 ≠ 长事务）：双库 DELETE journal，写事务会排他锁文件；
 * 跨 LLM 调用持锁会饿死宿主的投递轮询。故 withMailboxSession 只管理连接生命周期
 * （open → 回调 → close），原子性由单语句保证（宿主的 armTaskAtomically 同理）。
 *
 * 借鉴：nanoclaw container/agent-runner/src/mailbox/index.ts
 *
 * 修改记录：2026-10-06 创建（P0-1：mailbox 抽象层）
 */
import { sqliteSession } from "./sqlite/operations.ts";
import { closeOutboundDb } from "../db/connection.ts";
import type { MailboxAction, MailboxSession } from "./types.ts";

export type { MailboxAction, MailboxBatch, MailboxMessage, MailboxSession, OutboundDraft } from "./types.ts";

let mailboxInstance: AgentMailbox | null = null;

export interface AgentMailbox {
  /**
   * 统一执行入口：在邮箱会话内运行 action（连接一次打开、用毕即关）。
   * MCP 工具经此调度，不再在 handler 里直接碰 db 层。
   */
  run<T>(action: MailboxAction<T>): Promise<T>;
}

export function getAgentMailbox(): AgentMailbox {
  if (!mailboxInstance) {
    mailboxInstance = {
      run: async <T>(action: MailboxAction<T>): Promise<T> => withMailboxSession(action),
    };
  }
  return mailboxInstance;
}

/** 仅供测试 */
export function resetMailboxForTest(): void {
  mailboxInstance = null;
}

/**
 * 在一个邮箱会话内执行回调：会话对象持有全部操作面（读批/ack/出站/状态 KV），
 * 回调结束（无论成败）后关闭 outbound 连接。返回回调的返回值。
 */
export async function withMailboxSession<T>(fn: (session: MailboxSession) => T | Promise<T>): Promise<T> {
  const session = sqliteSession();
  try {
    return await fn(session);
  } finally {
    closeOutboundDb();
  }
}

export { readMailboxContext } from "./compose.ts";
