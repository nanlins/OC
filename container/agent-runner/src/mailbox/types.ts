/**
 * mailbox/types.ts —— mailbox 抽象的类型契约
 *
 * 职责：消息行、批次、路由、会话与 action 类型。容器侧唯一与宿主共享的形态契约
 * 是双 SQLite 的 schema（inbound.db / outbound.db），本文件把这一形态显式化。
 * 借鉴：nanoclaw container/agent-runner/src/mailbox/types.ts
 *
 * 修改记录：2026-10-06 创建（P0-1：mailbox 抽象层）
 */

/** 入站消息行（与宿主 src/db/session-db.ts 的 messages_in 列逐字对齐）。 */
export interface MailboxMessage {
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

/** 出站消息写入参数（与 messages_out 列对齐）。 */
export interface OutboundDraft {
  id: string;
  kind: string;
  content: string;
  operation?: string | null;
  streamFinal?: boolean;
  inReplyTo?: string | null;
  deliverAfter?: string | null;
  recurrence?: string | null;
  platformId?: string | null;
  channelType?: string | null;
  threadId?: string | null;
}

/** 一批待处理消息及其路由（poll-loop 一个批次的输入）。 */
export interface MailboxBatch {
  messages: MailboxMessage[];
  /** 批路由：取最后一条消息的 platform/channel/thread（无则回退 null）。 */
  routing: {
    platformId: string | null;
    channelType: string | null;
    threadId: string | null;
  };
}

/**
 * 邮箱会话：一次"读批 → 处理 → 写结果"生命周期的连接与操作面。
 *
 * 承重说明（为什么不跨 LLM 调用持有 SQLite 事务）：双库是 DELETE journal 模式，
 * 写事务会排他锁文件——若把事务横跨 provider.query（可能几十秒），宿主的投递轮询
 * 将无法读 outbound.db。因此会话边界 = 连接生命周期（一次打开、用毕即关），
 * 原子性落在单语句（含宿主的 armTaskAtomically 条件插入），不在长事务。
 */
export interface MailboxSession {
  /** 读取待处理消息（排除已 ack、系统类、未到期、非首轮 on_wake）。 */
  readPending(opts: { isFirstPoll: boolean; max: number; nowIso: string }): MailboxMessage[];
  /** 把消息标记为 processing（写 outbound 的 processing_ack）。 */
  markProcessing(ids: string[]): void;
  markCompleted(ids: string[]): void;
  markFailed(ids: string[]): void;
  /** P0-3：pre-task 脚本门控拒绝（写 status='script-skip:error'）。 */
  markScriptSkip(ids: string[]): void;
  /** 写出站消息（容器单写者，奇数 seq）。返回 seq。 */
  writeOutbound(draft: OutboundDraft): number;
  /** 会话状态 KV 读写（session_state 表）。 */
  getState(key: string): string | null;
  setState(key: string, value: string): void;
  deleteState(key: string): void;
}

/** 在邮箱会话内执行的 action（MCP 工具与 poll-loop 的统一入口）。 */
export type MailboxAction<T> = (session: MailboxSession) => T | Promise<T>;
