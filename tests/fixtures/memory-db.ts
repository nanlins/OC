/**
 * tests/fixtures/memory-db.ts —— 内存 DB 帮助函数
 *
 * 职责：提供测试数据库初始化（initTestDb + runMigrations 一站式）。
 * 关键导出：initTestDb, closeTestDb, setupTestDb
 * 借鉴：测试策略文档第十二章
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { initTestDb, closeDb } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrations/index.js";
import { migration001 } from "../../src/db/migrations/001-initial.js";

export { initTestDb };

export function closeTestDb(): void {
  closeDb();
}

export function setupTestDb(): ReturnType<typeof initTestDb> {
  const db = initTestDb();
  runMigrations(db, [migration001]);
  return db;
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

