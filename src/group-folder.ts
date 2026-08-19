/**
 * group-folder.ts —— Agent 群组文件夹名校验与路径安全解析
 *
 * 职责：白名单正则 + 保留字 + path.relative 逃逸检查三重防御。
 * 关键导出：isValidGroupFolder, assertValidGroupFolder, resolveGroupFolderPath
 * 借鉴：nanoclaw src/group-folder.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import { join, relative } from "node:path";
import { GROUPS_DIR } from "./config.js";

const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESERVED = new Set(["global"]);

export function isValidGroupFolder(folder: string): boolean {
  return FOLDER_RE.test(folder) && !RESERVED.has(folder);
}

export function assertValidGroupFolder(folder: string): void {
  if (!isValidGroupFolder(folder)) throw new Error(`invalid agent group folder: ${folder}`);
}

export function resolveGroupFolderPath(folder: string): string {
  assertValidGroupFolder(folder);
  const p = join(GROUPS_DIR, folder);
  if (relative(GROUPS_DIR, p).startsWith("..")) throw new Error(`folder escapes groups dir: ${folder}`);
  return p;
}
