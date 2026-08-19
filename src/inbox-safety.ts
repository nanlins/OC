/**
 * inbox-safety.ts —— per-message 收件箱目录容纳守卫
 *
 * 职责：防被攻陷容器预置符号链接劫持宿主写入（CWE-59）。
 * 关键导出：isPathInside, ensureContainedInboxDir
 * 核心模式：四道顺序防御：lstat 根拒符号链接 → lstat 子目录 → mkdir → realpath 容纳校验；
 *           返回 null 由调用方记上下文日志（借鉴 nanoclaw src/inbox-safety.ts，GHSA #2828 教训）。
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { lstatSync, mkdirSync, realpathSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { log } from "./log.js";

export function isPathInside(parent: string, child: string): boolean {
  const p = resolve(child);
  const par = resolve(parent);
  const sep = process.platform === "win32" ? "\\" : "/";
  return p === par || p.startsWith(par + sep);
}

/**
 * 确保 inbox 子目录存在且被根目录容纳。任何防御失败返回 null（不抛错，调用方记日志放弃该附件）。
 */
export function ensureContainedInboxDir(inboxRoot: string, messageId: string, context: string): string | null {
  try {
    // 1) 根目录不得是符号链接
    if (existsSync(inboxRoot)) {
      const rootStat = lstatSync(inboxRoot);
      if (rootStat.isSymbolicLink()) {
        log.warn(`inbox root is symlink; refusing (${context})`);
        return null;
      }
    } else {
      mkdirSync(inboxRoot, { recursive: true });
    }
    const target = join(inboxRoot, messageId);
    // 2) 子目录若已存在：拒符号链接、拒非目录（P1 修复：普通文件预置也拒）
    if (existsSync(target)) {
      const st = lstatSync(target);
      if (st.isSymbolicLink() || !st.isDirectory()) {
        log.warn(`inbox dir pre-existing non-dir/symlink; refusing (${context})`);
        return null;
      }
    } else {
      // 3) 创建
      mkdirSync(target, { recursive: true });
    }
    // 4) realpath 容纳校验（既有目录也必须校验，P1 修复）
    const realRoot = realpathSync(inboxRoot);
    const realTarget = realpathSync(target);
    if (!isPathInside(realRoot, realTarget)) {
      log.warn(`inbox dir escapes root after realpath; refusing (${context})`);
      return null;
    }
    return realTarget;
  } catch (err) {
    log.warn(`inbox dir ensure failed (${context})`, { err });
    return null;
  }
}
