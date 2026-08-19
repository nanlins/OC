/**
 * db/session-state.ts —— 容器持久 KV（outbound.db session_state）
 *
 * 职责：continuation 按 provider 分键 / current_in_reply_to 跨进程可见。
 * 关键导出：getContinuation, setContinuation, clearContinuation, setCurrentInReplyTo, getCurrentInReplyTo, clearCurrentInReplyTo
 * 借鉴：nanoclaw container/agent-runner/src/db/session-state.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 ai-inspector 修复：历史持久化 get/set/clearHistory（条目/字节双上限轮换）
 */
import { getOutboundDb, runNamed } from "./connection.ts";

function get(key: string): string | null {
  const row = getOutboundDb().prepare("SELECT value FROM session_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function set(key: string, value: string): void {
  runNamed(
    getOutboundDb().prepare(
      `INSERT INTO session_state (key, value, updated_at) VALUES ($k, $v, $now)
       ON CONFLICT (key) DO UPDATE SET value=$v, updated_at=$now`,
    ),
    { $k: key, $v: value, $now: new Date().toISOString() },
  );
}

function del(key: string): void {
  getOutboundDb().run("DELETE FROM session_state WHERE key = ?", [key]);
}

export function continuationKey(provider: string): string {
  return `continuation:${provider}`;
}

export function getContinuation(provider: string): string | null {
  return get(continuationKey(provider));
}

export function setContinuation(provider: string, value: string): void {
  set(continuationKey(provider), value);
}

export function clearContinuation(provider: string): void {
  del(continuationKey(provider));
}

export function setCurrentInReplyTo(value: string): void {
  set("current_in_reply_to", value);
}

export function getCurrentInReplyTo(): string | null {
  return get("current_in_reply_to");
}

export function clearCurrentInReplyTo(): void {
  del("current_in_reply_to");
}

// ---- 会话历史持久化（P1-3 修复：continuation 真实语义 = 状态化历史） ----

export interface HistoryEntry {
  role: "user" | "assistant" | "tool";
  content: string;
}

const HISTORY_MAX_ENTRIES = 20;
const HISTORY_MAX_BYTES = 64_000;

export function getHistory(provider: string): HistoryEntry[] {
  const raw = get(`history:${provider}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 保存历史：条目数 + 字节数双上限（超限截断最旧，即"轮换"的显式降级形态） */
export function setHistory(provider: string, entries: HistoryEntry[]): void {
  let capped = entries.slice(-HISTORY_MAX_ENTRIES);
  let serialized = JSON.stringify(capped);
  while (serialized.length > HISTORY_MAX_BYTES && capped.length > 1) {
    capped = capped.slice(1);
    serialized = JSON.stringify(capped);
  }
  set(`history:${provider}`, serialized);
}

export function clearHistory(provider: string): void {
  del(`history:${provider}`);
}
