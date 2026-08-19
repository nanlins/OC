/**
 * migrations/index.ts —— 迁移运行器
 *
 * 职责：name 键控的迁移系统 + 模块迁移命名空间 + FK 安全协议。
 * 关键导出：Migration, registerMigration, runMigrations, MODULE_MIGRATION_NAME_RE
 * 承重不变量（借鉴 nanoclaw src/db/migrations/index.ts 的事故复盘）：
 *   1. 去重键是 name 不是 version；发布后永不改名；
 *   2. 模块迁移必须 `module:<owner>:<id>` 命名空间；内建迁移永不带 module: 前缀；
 *   3. disableForeignKeys 的迁移：事务【外】切 foreign_keys=OFF（事务内该 pragma 是静默 no-op），
 *      事务【内】先快照 foreign_key_check 既有违规，跑 up() 后只对本次【新引入】的违规抛错回滚
 *      （既有孤儿行只 warn，否则老安装每次启动崩溃循环）。
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 *   2026-08-12 增加 clearRegisteredMigrationsForTest（防测试间全局注册表泄漏）
 */
import type { Database } from "better-sqlite3";
import { log } from "../../log.js";

export interface Migration {
  /** 仅作为应用顺序提示；去重与幂等以 name 为准 */
  version: number;
  /** 发布后永不改名；模块迁移须匹配 MODULE_MIGRATION_NAME_RE */
  name: string;
  up: (db: Database) => void;
  /** 需要重建表等 FK 不友好操作时置 true */
  disableForeignKeys?: boolean;
}

export const MODULE_MIGRATION_NAME_RE = /^module:[a-z0-9-]+:[a-z0-9-]+$/;

const registeredModules: Migration[] = [];

/** 模块在 barrel 导入时注册自己的迁移；重名即抛错 */
export function registerMigration(m: Migration): void {
  if (!MODULE_MIGRATION_NAME_RE.test(m.name)) {
    throw new Error(`module migration name must match module:<owner>:<id>, got: ${m.name}`);
  }
  if (registeredModules.some((x) => x.name === m.name)) {
    throw new Error(`duplicate migration name: ${m.name}`);
  }
  registeredModules.push(m);
}

export function getRegisteredModuleMigrations(): readonly Migration[] {
  return registeredModules;
}

/** 仅供测试：清空模块迁移注册表（防测试间全局状态泄漏） */
export function clearRegisteredMigrationsForTest(): void {
  registeredModules.length = 0;
}

function ensureSchemaVersionTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
}

function appliedNames(db: Database): Set<string> {
  const rows = db.prepare("SELECT name FROM schema_version").all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function foreignKeyViolations(db: Database): Set<string> {
  // PRAGMA foreign_key_check 返回 {table, rowid, parent, fkid}（P1-4 修复：身份键含 parent+fkid，
  // 同一行违反多条 FK 时差分不被合并）
  const rows = db.pragma("foreign_key_check") as Array<{ table: string; rowid: number; parent: string; fkid: number }>;
  return new Set(rows.map((r) => `${r.table}:${r.rowid}:${r.parent}:${r.fkid}`));
}

function runOne(db: Database, m: Migration, nextVersion: number): void {
  if (m.disableForeignKeys) {
    // 事务外切 pragma：事务内该 pragma 是静默 no-op（nanoclaw 011 迁移翻车教训）
    db.pragma("foreign_keys = OFF");
    try {
      const tx = db.transaction(() => {
        const before = foreignKeyViolations(db);
        if (before.size > 0) {
          // P2-7 修复：既有孤儿行只 warn 不 fail（对齐 nanoclaw），便于运维发现腐化数据
          log.warn(`migration ${m.name}: ${before.size} pre-existing FK violation(s) tolerated`);
        }
        m.up(db);
        const after = foreignKeyViolations(db);
        const fresh = [...after].filter((v) => !before.has(v));
        if (fresh.length > 0) {
          throw new Error(`migration ${m.name} introduced ${fresh.length} new FK violation(s): ${fresh[0]}`);
        }
        db.prepare("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)").run(
          nextVersion,
          m.name,
          new Date().toISOString(),
        );
      });
      tx();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  } else {
    const tx = db.transaction(() => {
      m.up(db);
      db.prepare("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)").run(
        nextVersion,
        m.name,
        new Date().toISOString(),
      );
    });
    tx();
  }
  log.info(`migration applied: ${m.name}`);
}

/**
 * 运行迁移。内建迁移全部优先，模块迁移按注册顺序（barrel 导入顺序），不按 version 交错。
 * @param db 目标库
 * @param builtIn 内建迁移列表（测试可显式覆盖全部列表）
 */
export function runMigrations(db: Database, builtIn: Migration[]): void {
  ensureSchemaVersionTable(db);
  const all = [...builtIn, ...registeredModules];
  const seen = new Set<string>();
  for (const m of all) {
    if (seen.has(m.name)) throw new Error(`duplicate migration name in run list: ${m.name}`);
    seen.add(m.name);
  }
  const done = appliedNames(db);
  let nextVersion =
    ((db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null }).v ?? 0) + 1;
  for (const m of all) {
    if (done.has(m.name)) continue;
    runOne(db, m, nextVersion);
    nextVersion += 1;
  }
}
