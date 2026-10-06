/**
 * mailbox/sqlite/connection.ts —— mailbox 的 SQLite 连接面
 *
 * 职责：复用 db/connection.ts 的连接管理（DELETE journal 承重不变量、退避重试），
 * 以 mailbox 命名再导出。不重复实现连接逻辑。
 * 借鉴：nanoclaw container/agent-runner/src/mailbox/sqlite/connection.ts
 *
 * 修改记录：2026-10-06 创建（P0-1：mailbox 抽象层）
 */
export {
  getWorkspace,
  openInboundPoll,
  openInboundLongLived,
  getOutboundDb,
  closeOutboundDb,
  touchHeartbeat,
  clearStaleProcessingAcks,
} from "../../db/connection.ts";
