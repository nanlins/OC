/**
 * claude-md.ts —— 群组 CLAUDE.md 加载与系统提示注入（fix-plan P0）
 *
 * 职责：读取 /workspace/agent/CLAUDE.md（宿主只读挂载）并以带预算的 markdown 段注入系统提示。
 *       修复「CLAUDE.md 挂载但从未注入模型上下文」的上下文断点。
 * 关键导出：loadClaudeMd, renderClaudeMdSection, CLAUDE_MD_MAX_CHARS
 * 承重不变量：读取失败/缺失返回空串（不抛错）；超长截断并标注（防上下文爆炸）。
 *
 * 修改记录：2026-08-14 创建（fix-plan P0：Agent 加载 CLAUDE.md）
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CLAUDE_MD_MAX_CHARS = 20000;

/** 读取 workspace/agent/CLAUDE.md；缺失/错误返回空串 */
export function loadClaudeMd(workspace: string): string {
  try {
    const p = join(workspace, "agent", "CLAUDE.md");
    if (!existsSync(p)) return "";
    const raw = readFileSync(p, "utf8").trim();
    if (!raw) return "";
    if (raw.length > CLAUDE_MD_MAX_CHARS) return raw.slice(0, CLAUDE_MD_MAX_CHARS) + "\n[…CLAUDE.md truncated by budget]";
    return raw;
  } catch {
    return "";
  }
}

/** 拼为系统提示段（群组指令为人格/行为基线，置于技能/记忆之前） */
export function renderClaudeMdSection(content: string): string {
  if (!content) return "";
  return `# Group Instructions\n${content}\n`;
}
