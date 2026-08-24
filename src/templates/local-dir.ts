/**
 * templates/local-dir.ts —— 本地模板目录解析
 *
 * 职责：将相对 ref 解析为 TEMPLATES_DIR 下的绝对路径。仅词汇包含检查——
 *       不 resolve symlink。拒绝绝对路径/~ 前缀/路径穿越。
 * 关键导出：resolveLocalTemplate
 * 借鉴：nanoclaw src/templates/local-dir.ts
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { TEMPLATES_DIR } from "../config.js";

export function resolveLocalTemplate(ref: string, base: string = TEMPLATES_DIR): string {
  if (!ref || ref !== ref.trim()) throw new Error(`Invalid template ref: "${ref}"`);
  if (isAbsolute(ref) || ref.startsWith("~")) throw new Error(`Template ref must be relative: "${ref}"`);

  const candidate = resolve(base, ref);
  const rel = relative(base, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Template ref escapes: "${ref}"`);

  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error(`Template not found: "${ref}" (looked in ${base})`);
  }
  return candidate;
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

