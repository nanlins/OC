/**
 * modules/session-summarizer.ts —— 会话摘要与压缩
 *
 * 职责：自动摘要旧会话 + 分层记忆（近/中/远期）+ 压缩注入。
 *       当会话消息超过阈值时触发摘要；摘要作为系统提示前缀注入。
 * 关键导出：summarizeSession, getSessionSummary, shouldSummarize, SessionSummary
 * 知识文档映射：04-Agent应用详解 §4.6 上下文工程
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */
import { getDb } from "../db/connection.js";
import { randomUUID } from "node:crypto";

export interface SessionSummary {
  id: string;
  sessionId: string;
  agentGroupId: string;
  rangeStart: number;
  rangeEnd: number;
  summary: string;
  messageCount: number;
  tokenEstimate: number;
  createdAt: string;
}

const SUMMARY_THRESHOLD_MSGS = 50;
const SUMMARY_THRESHOLD_TOKENS = 8000;

function ensureSummaryTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_group_id TEXT NOT NULL,
      range_start INTEGER NOT NULL,
      range_end INTEGER NOT NULL,
      summary TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      token_estimate INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_summary_session ON session_summaries(session_id, range_start);
  `);
}

export function shouldSummarize(messageCount: number, estimatedTokens: number): boolean {
  return messageCount >= SUMMARY_THRESHOLD_MSGS || estimatedTokens >= SUMMARY_THRESHOLD_TOKENS;
}

export function storeSessionSummary(opts: {
  sessionId: string;
  agentGroupId: string;
  rangeStart: number;
  rangeEnd: number;
  summary: string;
  messageCount: number;
  tokenEstimate: number;
}): SessionSummary {
  ensureSummaryTable();
  const row: SessionSummary = {
    id: randomUUID(),
    sessionId: opts.sessionId,
    agentGroupId: opts.agentGroupId,
    rangeStart: opts.rangeStart,
    rangeEnd: opts.rangeEnd,
    summary: opts.summary,
    messageCount: opts.messageCount,
    tokenEstimate: opts.tokenEstimate,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO session_summaries (id, session_id, agent_group_id, range_start, range_end, summary, message_count, token_estimate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.sessionId,
      row.agentGroupId,
      row.rangeStart,
      row.rangeEnd,
      row.summary,
      row.messageCount,
      row.tokenEstimate,
      row.createdAt,
    );
  return row;
}

export function getSessionSummary(sessionId: string, limit: number = 5): SessionSummary[] {
  ensureSummaryTable();
  return getDb()
    .prepare("SELECT * FROM session_summaries WHERE session_id = ? ORDER BY range_start DESC LIMIT ?")
    .all(sessionId, limit) as SessionSummary[];
}

export function getLatestSummary(sessionId: string): SessionSummary | null {
  const rows = getSessionSummary(sessionId, 1);
  return rows[0] ?? null;
}

export function buildSummaryContext(sessionId: string): string {
  const summaries = getSessionSummary(sessionId, 3);
  if (summaries.length === 0) return "";

  const parts = summaries.reverse().map((s) => s.summary);
  return `<conversation_summary>\n${parts.join("\n\n---\n\n")}\n</conversation_summary>`;
}

export function estimateTokens(text: string): number {
  // 粗略估算：中文 ~1.5 字符/token，英文 ~4 字符/token
  const cnChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - cnChars;
  return Math.ceil(cnChars / 1.5 + otherChars / 4);
}
