/**
 * attachment-safety.ts —— 附件名安全判定
 *
 * 职责：路径最后一段是否安全（防 ../../、NUL、盘符前缀）。
 * 关键导出：isSafeAttachmentName
 * 借鉴：nanoclaw src/attachment-safety.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { basename } from "node:path";

export function isSafeAttachmentName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.includes("\0")) return false;
  if (/[/\\]/.test(name)) return false;
  // basename(name) !== name 覆盖 Windows 盘符前缀（如 C:evil.txt）
  if (basename(name) !== name) return false;
  return true;
}
