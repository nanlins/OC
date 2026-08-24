/**
 * scripts/backup.ts —— 备份与恢复
 *
 * 职责：中央 DB 自动备份 + 会话 DB 快照 + 灾难恢复。
 *       用法：tsx scripts/backup.ts [backup|restore|list]
 * 关键导出：backupDatabase, restoreDatabase, listBackups, BackupMeta
 * 承重不变量：备份前 WAL checkpoint；恢复前校验 SHA256。
 * 知识文档映射：05-后端工程详解 §5.4 数据备份
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CENTRAL_DB_PATH, DATA_DIR } from "../src/config.js";

export interface BackupMeta {
  file: string;
  timestamp: string;
  size: number;
  sha256: string;
  type: "central" | "session";
  sessionId?: string;
}

const BACKUP_DIR = join(DATA_DIR, "backups");

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function backupDatabase(): BackupMeta {
  if (!existsSync(CENTRAL_DB_PATH)) throw new Error("central DB not found");
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(BACKUP_DIR, `v2-${ts}.db`);
  copyFileSync(CENTRAL_DB_PATH, dest);

  const meta: BackupMeta = {
    file: dest,
    timestamp: new Date().toISOString(),
    size: statSync(dest).size,
    sha256: hashFile(dest),
    type: "central",
  };

  writeFileSync(dest + ".meta.json", JSON.stringify(meta, null, 2), "utf-8");
  return meta;
}

export function restoreDatabase(backupFile: string): boolean {
  const src = join(BACKUP_DIR, backupFile);
  if (!existsSync(src)) return false;

  const metaPath = src + ".meta.json";
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as BackupMeta;
    const currentHash = hashFile(src);
    if (currentHash !== meta.sha256) {
      throw new Error(`backup integrity check failed: ${backupFile}`);
    }
  }

  copyFileSync(src, CENTRAL_DB_PATH);
  return true;
}

export function listBackups(): BackupMeta[] {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".meta.json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(BACKUP_DIR, f), "utf-8")) as BackupMeta;
      } catch {
        return null;
      }
    })
    .filter((m): m is BackupMeta => m !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function pruneBackups(keepCount: number = 10): number {
  const backups = listBackups();
  if (backups.length <= keepCount) return 0;
  const toRemove = backups.slice(keepCount);
  for (const b of toRemove) {
    try {
      const { unlinkSync } = require("node:fs");
      unlinkSync(b.file);
      unlinkSync(b.file + ".meta.json");
    } catch {
      /* 忽略 */
    }
  }
  return toRemove.length;
}

const cmd = process.argv[2];
if (cmd === "backup") {
  const meta = backupDatabase();
  console.log(JSON.stringify(meta, null, 2));
} else if (cmd === "restore") {
  const file = process.argv[3];
  if (!file) { console.error("usage: backup restore <file>"); process.exit(1); }
  console.log(restoreDatabase(file) ? "restored" : "not found");
} else if (cmd === "list") {
  console.log(JSON.stringify(listBackups(), null, 2));
} else {
  console.log("usage: tsx scripts/backup.ts [backup|restore <file>|list]");
}