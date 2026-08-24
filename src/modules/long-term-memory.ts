/**
 * modules/long-term-memory.ts —— 长期记忆系统
 *
 * 职责：用户偏好持久化 + 语义记忆存储 + 记忆衰减 + 跨会话检索。
 *       记忆分为 preference（偏好）/ semantic（语义）/ episodic（情节）三类。
 * 关键导出：storeMemory, recallMemory, forgetMemory, MemoryEntry, MemoryType
 * 承重不变量：记忆召回按衰减系数排序；过期记忆定期清理。
 * 知识文档映射：04-Agent应用详解 §4.9 记忆系统
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */
import { getDb } from "../db/connection.js";
import { randomUUID } from "node:crypto";
import { log } from "../log.js";

export type MemoryType = "preference" | "semantic" | "episodic";

export interface MemoryEntry {
  id: string;
  userId: string | null;
  agentGroupId: string | null;
  type: MemoryType;
  key: string;
  value: string;
  importance: number;
  decayRate: number;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
}

const DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天半衰期

function ensureMemoryTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS long_term_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      agent_group_id TEXT,
      type TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      decay_rate REAL DEFAULT 0.1,
      created_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      access_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_memory_user ON long_term_memory(user_id, type);
    CREATE INDEX IF NOT EXISTS idx_memory_key ON long_term_memory(key);
  `);
}

export function storeMemory(
  entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount" | "decayRate"> & {
    decayRate?: number;
  },
): MemoryEntry {
  ensureMemoryTable();
  const now = new Date().toISOString();
  const row: MemoryEntry = {
    id: randomUUID(),
    createdAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    decayRate: entry.decayRate ?? 0.1,
    ...entry,
  };
  getDb()
    .prepare(
      `INSERT INTO long_term_memory (id, user_id, agent_group_id, type, key, value, importance, decay_rate, created_at, last_accessed_at, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.userId,
      row.agentGroupId,
      row.type,
      row.key,
      row.value,
      row.importance,
      row.decayRate,
      row.createdAt,
      row.lastAccessedAt,
      row.accessCount,
    );
  return row;
}

export function recallMemory(opts: {
  userId?: string | null;
  agentGroupId?: string | null;
  type?: MemoryType;
  key?: string;
  limit?: number;
}): MemoryEntry[] {
  ensureMemoryTable();
  const now = Date.now();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.userId !== undefined) {
    conditions.push("user_id = ?");
    params.push(opts.userId);
  }
  if (opts.agentGroupId !== undefined) {
    conditions.push("agent_group_id = ?");
    params.push(opts.agentGroupId);
  }
  if (opts.type) {
    conditions.push("type = ?");
    params.push(opts.type);
  }
  if (opts.key) {
    conditions.push("key = ?");
    params.push(opts.key);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT * FROM long_term_memory ${where} ORDER BY importance DESC LIMIT ?`)
    .all(...params, opts.limit ?? 50) as MemoryEntry[];

  // 更新访问计数
  for (const row of rows) {
    getDb()
      .prepare("UPDATE long_term_memory SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?")
      .run(new Date().toISOString(), row.id);
  }

  // 按衰减系数重排序
  return rows.sort((a, b) => {
    const ageA = now - new Date(a.lastAccessedAt).getTime();
    const ageB = now - new Date(b.lastAccessedAt).getTime();
    const decayA = a.importance * Math.exp((-a.decayRate * ageA) / DECAY_HALF_LIFE_MS);
    const decayB = b.importance * Math.exp((-b.decayRate * ageB) / DECAY_HALF_LIFE_MS);
    return decayB - decayA;
  });
}

export function forgetMemory(id: string): boolean {
  ensureMemoryTable();
  const result = getDb().prepare("DELETE FROM long_term_memory WHERE id = ?").run(id);
  return result.changes > 0;
}

export function forgetByKey(key: string, userId?: string | null): number {
  ensureMemoryTable();
  let sql = "DELETE FROM long_term_memory WHERE key = ?";
  const params: unknown[] = [key];
  if (userId !== undefined) {
    sql += " AND user_id = ?";
    params.push(userId);
  }
  const result = getDb()
    .prepare(sql)
    .run(...params);
  return result.changes;
}

export function pruneExpiredMemories(): number {
  ensureMemoryTable();
  const threshold = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const result = getDb()
    .prepare("DELETE FROM long_term_memory WHERE last_accessed_at < ? AND importance < 0.3")
    .run(threshold);
  if (result.changes > 0) {
    log.info("pruned expired memories", { count: result.changes });
  }
  return result.changes;
}
