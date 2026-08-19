/**
 * connection.ts —— 中央 DB 连接管理
 *
 * 职责：单例连接 initDb/getDb/closeDb/initTestDb + hasTable 模块守卫。
 * 关键导出：initDb, getDb, closeDb, initTestDb, hasTable
 * 承重不变量：中央库用 WAL + foreign_keys=ON（会话级双库用 DELETE，见 session-db.ts）。
 * 借鉴：nanoclaw src/db/connection.ts（claw开源项目源码/src/db/connection.ts）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 */
import Database from "better-sqlite3";

let db: Database.Database | null = null;

/** 初始化中央 DB（生产路径）：WAL + 外键开启 */
export function initDb(path: string): Database.Database {
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

/** 内存测试库（外键开启，无 WAL 需求） */
export function initTestDb(): Database.Database {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

/** 获取已初始化的连接；未初始化即抛错（fail-fast） */
export function getDb(): Database.Database {
  if (!db) throw new Error("central db not initialized: call initDb()/initTestDb() first");
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * sqlite_master 表存在性探测。
 * 模块未安装时其私有表不存在，核心代码调用此守卫静默降级（借鉴 nanoclaw hasTable 模式）。
 */
export function hasTable(name: string): boolean {
  return getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !== undefined;
}
