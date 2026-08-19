/**
 * modules/observability.ts —— 可观测性模块（知识文档 04 §4.11 落地）
 *
 * 职责：模块迁移建 guard_audit 表；注册 delivery-guard 审计 sink（allow/hold/deny 全留痕）；
 *       查询助手。全程留痕：actor/action/decision/reason/时间。
 * 关键导出：queryGuardAudit
 * 借鉴：nanoclaw 无独立审计表（自主扩展，se-inspector P2 建议落地）。
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 */
import { getDb } from "../db/connection.js";
import { registerMigration } from "../db/migrations/index.js";
import { setAuditSink } from "../delivery-guard.js";

registerMigration({
  version: 901,
  name: "module:observability:guard-audit",
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS guard_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_guard_audit_action ON guard_audit(action);
    `);
  },
});

setAuditSink((entry) => {
  getDb()
    .prepare("INSERT INTO guard_audit (action, actor, decision, reason, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(entry.action, entry.actor, entry.decision, entry.reason, new Date().toISOString());
});

export function queryGuardAudit(action?: string, limit = 50): Array<Record<string, unknown>> {
  const db = getDb();
  if (action) {
    return db
      .prepare("SELECT * FROM guard_audit WHERE action = ? ORDER BY id DESC LIMIT ?")
      .all(action, limit) as Array<Record<string, unknown>>;
  }
  return db.prepare("SELECT * FROM guard_audit ORDER BY id DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
}
