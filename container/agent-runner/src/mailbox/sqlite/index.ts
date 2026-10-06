/**
 * mailbox/sqlite/index.ts —— SQLite mailbox 实现入口
 *
 * 职责：对外只暴露 createSqliteMailbox()（内含 sqliteSession 工厂）。
 * 借鉴：nanoclaw container/agent-runner/src/mailbox/sqlite/index.ts
 *
 * 修改记录：2026-10-06 创建（P0-1：mailbox 抽象层）
 */
import { sqliteSession } from "./operations.ts";
import type { MailboxSession } from "../types.ts";

export function createSqliteMailbox(): { openSession: () => MailboxSession } {
  return { openSession: () => sqliteSession() };
}

export { sqliteSession };
