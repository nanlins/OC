/**
 * modules/quota.ts —— 配额与限流模块（不引入 Redis，SQLite 持久化）
 *
 * 职责：模块迁移建 usage_daily 表；recordUsage(user, tokens)；checkQuota 按日上限判定。
 * 关键导出：recordUsage, checkQuota, DEFAULT_DAILY_TOKEN_LIMIT
 * 借鉴：知识文档 05（Redis 限流的 SQLite 降级形态，单进程主机足够）。
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 */
import { getDb } from "../db/connection.js";
import { registerMigration } from "../db/migrations/index.js";

registerMigration({
  version: 902,
  name: "module:quota:usage",
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_daily (
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
    `);
  },
});

export const DEFAULT_DAILY_TOKEN_LIMIT = 500_000;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function recordUsage(userId: string, tokens: number): void {
  getDb()
    .prepare(
      `INSERT INTO usage_daily (user_id, day, tokens) VALUES (?, ?, ?)
       ON CONFLICT (user_id, day) DO UPDATE SET tokens = tokens + excluded.tokens`,
    )
    .run(userId, today(), tokens);
}

export function checkQuota(userId: string, limit = DEFAULT_DAILY_TOKEN_LIMIT): { allowed: boolean; used: number } {
  const row = getDb().prepare("SELECT tokens FROM usage_daily WHERE user_id = ? AND day = ?").get(userId, today()) as
    { tokens: number } | undefined;
  const used = row?.tokens ?? 0;
  return { allowed: used < limit, used };
}
