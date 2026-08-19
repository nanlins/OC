/**
 * skills/loader.ts —— 容器技能加载器（SKILL.md frontmatter 解析 + 系统提示注入）
 *
 * 职责：扫描技能目录（/app/skills 或注入目录）→ 解析 frontmatter（name/description）→
 *       按预算拼入系统提示附录（技能指令即上下文，知识文档 02 提示词工程）。
 * 关键导出：loadSkills, parseFrontmatter, SkillDoc
 *
 * 修改记录：2026-08-13 创建（阶段 13）
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SkillDoc {
  name: string;
  description: string;
  body: string;
}

export const SKILLS_BUDGET_CHARS = 12000;

export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

export function loadSkills(dir: string): SkillDoc[] {
  if (!existsSync(dir)) return [];
  const out: SkillDoc[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = join(dir, entry.name, "SKILL.md");
    if (!existsSync(p)) continue;
    const { meta, body } = parseFrontmatter(readFileSync(p, "utf8"));
    out.push({ name: meta.name ?? entry.name, description: meta.description ?? "", body });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 按预算拼入系统提示（超预算截断并标注，防上下文爆炸） */
export function renderSkillsSection(skills: SkillDoc[], budget = SKILLS_BUDGET_CHARS): string {
  const parts: string[] = [];
  let used = 0;
  for (const s of skills) {
    const block = `## skill: ${s.name}\n${s.body.trim()}\n`;
    if (used + block.length > budget) {
      parts.push(`<!-- skills truncated by budget -->`);
      break;
    }
    parts.push(block);
    used += block.length;
  }
  return parts.length ? `# Skills\n${parts.join("\n")}` : "";
}
