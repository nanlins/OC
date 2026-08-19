/**
 * migrations.test.ts —— 迁移运行器单元测试
 *
 * 职责：验证 name 键控幂等、模块命名空间校验、重名抛错、FK 安全协议（新违规回滚/既有违规容忍）。
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 *   2026-08-12 修正：better-sqlite3 默认开启外键，孤儿制造需显式 OFF
 */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRegisteredMigrationsForTest,
  registerMigration,
  runMigrations,
  type Migration,
} from "../../src/db/migrations/index.js";

afterEach(() => clearRegisteredMigrationsForTest());

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

describe("migration runner", () => {
  it("applies migrations once and is idempotent by name", () => {
    const db = freshDb();
    const m: Migration = {
      version: 1,
      name: "test-create",
      up: (d) => d.exec("CREATE TABLE t1 (id TEXT PRIMARY KEY)"),
    };
    runMigrations(db, [m]);
    runMigrations(db, [m]); // 重跑不抛错
    const rows = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get() as { c: number };
    expect(rows.c).toBe(1);
    expect(db.prepare("SELECT name FROM schema_version").get()).toEqual({ name: "test-create" });
  });

  it("rejects duplicate names in a single run list", () => {
    const db = freshDb();
    const a: Migration = { version: 1, name: "dup", up: () => {} };
    const b: Migration = { version: 2, name: "dup", up: () => {} };
    expect(() => runMigrations(db, [a, b])).toThrow(/duplicate/i);
  });

  it("enforces module: namespace for registerMigration", () => {
    expect(() => registerMigration({ version: 90, name: "bad-name", up: () => {} })).toThrow(/module:/);
    expect(() => registerMigration({ version: 91, name: "module:tester:ok-one", up: () => {} })).not.toThrow();
    expect(() => registerMigration({ version: 91, name: "module:tester:ok-one", up: () => {} })).toThrow(/duplicate/i);
  });

  it("FK protocol rolls back new violations introduced by disableForeignKeys migration", () => {
    const db = freshDb();
    db.exec(
      "CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (id TEXT PRIMARY KEY, p TEXT REFERENCES parent(id));",
    );
    const bad: Migration = {
      version: 1,
      name: "test-fk-bad",
      disableForeignKeys: true,
      up: (d) => d.exec("INSERT INTO child (id, p) VALUES ('c1', 'missing-parent')"),
    };
    expect(() => runMigrations(db, [bad])).toThrow(/FK violation/i);
    // 回滚后未记录为已应用
    expect(db.prepare("SELECT COUNT(*) AS c FROM schema_version").get()).toEqual({ c: 0 });
  });

  it("FK protocol tolerates pre-existing orphan rows", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = OFF"); // better-sqlite3 默认 ON，显式关闭以制造既有孤儿
    db.exec(
      "CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (id TEXT PRIMARY KEY, p TEXT REFERENCES parent(id));",
    );
    db.exec("INSERT INTO child (id, p) VALUES ('orphan', 'gone')");
    db.pragma("foreign_keys = ON");
    const ok: Migration = {
      version: 1,
      name: "test-fk-tolerant",
      disableForeignKeys: true,
      up: (d) => d.exec("CREATE TABLE extra (x INTEGER)"),
    };
    expect(() => runMigrations(db, [ok])).not.toThrow();
    expect(db.prepare("SELECT name FROM schema_version").get()).toEqual({ name: "test-fk-tolerant" });
  });
});

describe("multi-FK differential (P1-4 regression)", () => {
  function multiFkDb(): Database.Database {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE p1 (id TEXT PRIMARY KEY);
      CREATE TABLE p2 (id TEXT PRIMARY KEY);
      CREATE TABLE c (id TEXT PRIMARY KEY, a TEXT REFERENCES p1(id), b TEXT REFERENCES p2(id));
    `);
    db.exec("INSERT INTO c (id, a, b) VALUES ('pre', 'gone1', 'gone2')");
    db.pragma("foreign_keys = ON");
    return db;
  }

  it("rolls back a disableForeignKeys migration that introduces orphans across multiple FKs", () => {
    const db = multiFkDb();
    const bad: Migration = {
      version: 1,
      name: "test-multi-fk-bad",
      disableForeignKeys: true,
      up: (d) => d.exec("INSERT INTO c (id, a, b) VALUES ('new', 'gone1', 'gone2')"),
    };
    expect(() => runMigrations(db, [bad])).toThrow(/FK violation/i);
    expect(db.prepare("SELECT COUNT(*) AS c FROM c WHERE id = 'new'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) AS c FROM schema_version").get()).toEqual({ c: 0 });
  });

  it("tolerates pre-existing multi-FK orphans when an unrelated migration runs", () => {
    const db = multiFkDb();
    const ok: Migration = {
      version: 2,
      name: "test-multi-fk-unrelated",
      disableForeignKeys: true,
      up: (d) => d.exec("CREATE TABLE unrelated (x INTEGER)"),
    };
    expect(() => runMigrations(db, [ok])).not.toThrow();
    expect(db.prepare("SELECT name FROM schema_version").get()).toEqual({ name: "test-multi-fk-unrelated" });
  });
});

/*
 * 修改记录：
 *   2026-08-12 末尾追加 multi-FK 差分回归测试（P1-4）：一行违反多条 FK 时新违规须被差分识别并回滚，
 *              既有多 FK 孤儿行容忍且无关迁移正常记录为已应用。
 */
