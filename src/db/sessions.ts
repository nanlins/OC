/**
 * sessions.ts —— sessions 表 CRUD
 *
 * 职责：会话生命周期行操作（创建/查找/列表/状态标记）。会话文件夹与双 DB 由 session-manager（阶段 2）负责。
 * 关键导出：createSession, getSession, findSession, listSessions, listActiveSessions, getRunningSessions,
 *           markContainerStatus, markSessionClosed, touchSession
 * 借鉴：nanoclaw src/db/sessions.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 *   2026-08-12 se-inspector 修复：findSession NULL messaging_group_id 用 IS ?（P1-1）；agent-shared 取最新（P2-5）
 */
import { randomUUID } from "node:crypto";
import { getDb } from "./connection.js";
import type { Session, SessionMode } from "../types.js";

/** 任务系统会话的 thread_id 约定（借鉴 nanoclaw TASKS_SYSTEM_THREAD_ID） */
export const TASKS_SYSTEM_THREAD_PREFIX = "system:tasks:";

export function taskThreadId(seriesId: string): string {
  return `${TASKS_SYSTEM_THREAD_PREFIX}${seriesId}`;
}

export function createSession(opts: {
  agentGroupId: string;
  messagingGroupId?: string | null;
  threadId?: string | null;
  agentProvider?: string | null;
}): Session {
  const row: Session = {
    id: randomUUID(),
    agent_group_id: opts.agentGroupId,
    messaging_group_id: opts.messagingGroupId ?? null,
    thread_id: opts.threadId ?? null,
    agent_provider: opts.agentProvider ?? null,
    status: "active",
    container_status: "stopped",
    last_active: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO sessions (id, agent_group_id, messaging_group_id, thread_id, agent_provider, status, container_status, last_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.agent_group_id,
      row.messaging_group_id,
      row.thread_id,
      row.agent_provider,
      row.status,
      row.container_status,
      row.last_active,
      row.created_at,
    );
  return row;
}

export function getSession(id: string): Session | undefined {
  return getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session | undefined;
}

/** 按 session_mode 三模式查找现有会话（借鉴 nanoclaw resolveSession 查找语义） */
export function findSession(opts: {
  agentGroupId: string;
  messagingGroupId?: string | null;
  threadId?: string | null;
  sessionMode: SessionMode;
}): Session | undefined {
  if (opts.sessionMode === "agent-shared") {
    return getDb()
      .prepare(
        "SELECT * FROM sessions WHERE agent_group_id = ? AND status = 'active' AND (thread_id IS NULL OR thread_id NOT LIKE ?) ORDER BY created_at DESC LIMIT 1",
      )
      .get(opts.agentGroupId, `${TASKS_SYSTEM_THREAD_PREFIX}%`) as Session | undefined;
  }
  if (opts.sessionMode === "per-thread" && opts.threadId) {
    // P2 修复：精确匹配，未命中即由调用方新建（基线语义；不再 fall-through 到 shared，
    // 防止重配线后线程消息并入既有 shared 会话）
    return getDb()
      .prepare(
        "SELECT * FROM sessions WHERE agent_group_id = ? AND messaging_group_id IS ? AND thread_id = ? AND status = 'active'",
      )
      .get(opts.agentGroupId, opts.messagingGroupId ?? null, opts.threadId) as Session | undefined;
  }
  if (opts.sessionMode === "per-thread") {
    // 无 thread 时退化为 shared 语义（调用方应已按线程策略折叠）
  }
  // IS ? 绑定：SQL 中 = NULL 恒不为真，任务会话（messaging_group_id 恒 NULL）必须走 IS（P1-1 修复）
  return getDb()
    .prepare(
      "SELECT * FROM sessions WHERE agent_group_id = ? AND messaging_group_id IS ? AND status = 'active' LIMIT 1",
    )
    .get(opts.agentGroupId, opts.messagingGroupId ?? null) as Session | undefined;
}

export function listSessions(): Session[] {
  return getDb().prepare("SELECT * FROM sessions ORDER BY last_active DESC").all() as Session[];
}

export function listActiveSessions(): Session[] {
  return getDb().prepare("SELECT * FROM sessions WHERE status = 'active'").all() as Session[];
}

export function getRunningSessions(): Session[] {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE status = 'active' AND container_status = 'running'")
    .all() as Session[];
}

export function markContainerStatus(id: string, status: "running" | "stopped"): void {
  getDb()
    .prepare("UPDATE sessions SET container_status = ?, last_active = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);
}

export function markSessionClosed(id: string): void {
  getDb().prepare("UPDATE sessions SET status = 'closed' WHERE id = ?").run(id);
}

export function touchSession(id: string): void {
  getDb().prepare("UPDATE sessions SET last_active = ? WHERE id = ?").run(new Date().toISOString(), id);
}
