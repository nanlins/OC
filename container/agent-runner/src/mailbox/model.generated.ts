/**
 * mailbox/model.generated.ts —— 与宿主 schema 对齐的共享模型
 *
 * 职责：把双库（inbound.db / outbound.db）的列契约集中于此。nanoclaw 里这个文件由
 * 宿主 `src/mailbox/model.ts` 同步生成；OC 尚未实现生成器（宿主无 mailbox model 源），
 * 因此这里是**手工同步**版本——任何宿主 schema 改动（src/db/session-db.ts 的
 * INBOUND_SCHEMA / OUTBOUND_SCHEMA）都必须同步改这里，两侧列必须逐字一致。
 * 不变量：本文件只做类型/常量声明，零副作用。
 *
 * 借鉴：nanoclaw container/agent-runner/src/mailbox/model.generated.ts
 *
 * 修改记录：2026-10-06 创建（P0-1：mailbox 抽象层）
 */

/** messages_in 的列清单（与宿主 INBOUND_SCHEMA 对齐）。 */
export const INBOUND_COLUMNS = [
  "id",
  "seq",
  "kind",
  "timestamp",
  "status",
  "process_after",
  "recurrence",
  "series_id",
  "tries",
  "trigger",
  "on_wake",
  "platform_id",
  "channel_type",
  "thread_id",
  "content",
  "source_session_id",
] as const;

/** messages_out 的列清单（与宿主 OUTBOUND_SCHEMA 对齐）。 */
export const OUTBOUND_COLUMNS = [
  "id",
  "seq",
  "in_reply_to",
  "timestamp",
  "deliver_after",
  "recurrence",
  "kind",
  "operation",
  "stream_final",
  "platform_id",
  "channel_type",
  "thread_id",
  "content",
] as const;

/** processing_ack 的列清单。 */
export const ACK_COLUMNS = ["message_id", "status", "status_changed"] as const;

/** session_state 的列清单。 */
export const SESSION_STATE_COLUMNS = ["key", "value", "updated_at"] as const;

/** 任务行状态白名单（与宿主 scheduling / host-sweep 的语义一致）。 */
export const TASK_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
