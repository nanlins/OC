/**
 * mailbox/sqlite/operations.ts —— mailbox 的 SQLite 操作实现
 *
 * 职责：readPending / markProcessing / markCompleted / markFailed / writeOutbound /
 *       会话状态读写。全部经 db/ 层函数，本文件只做会话形状适配。
 * 承重不变量：出站容器单写者（奇数 seq）；ack 写 outbound 的 processing_ack；
 *      会话状态写 session_state（updated_at 恒更新）。
 * 借鉴：nanoclaw container/agent-runner/src/mailbox/sqlite/operations.ts
 *
 * 修改记录：2026-10-06 创建（P0-1：mailbox 抽象层）
 */
import { getPendingMessages, markCompleted, markFailed, markProcessing, markScriptSkip } from "../../db/messages-in.ts";
import { writeMessageOut } from "../../db/messages-out.ts";
import { getState, setState, deleteState } from "../../db/session-state.ts";
import type { MailboxMessage, MailboxSession, OutboundDraft } from "../types.ts";

/** 组装一个 SQLite 邮箱会话（连接生命周期由 index.ts 的 withMailboxSession 管理）。 */
export function sqliteSession(): MailboxSession {
  return {
    readPending: (opts) => getPendingMessages(opts) as MailboxMessage[],
    markProcessing,
    markCompleted,
    markFailed,
    markScriptSkip,
    writeOutbound: (draft: OutboundDraft) =>
      writeMessageOut({
        id: draft.id,
        kind: draft.kind,
        content: draft.content,
        operation: draft.operation ?? null,
        streamFinal: draft.streamFinal,
        inReplyTo: draft.inReplyTo ?? null,
        deliverAfter: draft.deliverAfter ?? null,
        recurrence: draft.recurrence ?? null,
        platformId: draft.platformId ?? null,
        channelType: draft.channelType ?? null,
        threadId: draft.threadId ?? null,
      }),
    getState,
    setState,
    deleteState,
  };
}
