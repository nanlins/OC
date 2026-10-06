/**
 * memory/context.ts —— 记忆上下文组装（P1-1）
 *
 * 职责：renderMemorySection 输出完整 OKF v0.1 framing（说明性文字 + 权威文件 +
 *       截断说明）；截断按**码点**进行（代理对边界安全，绝不切出半个 emoji/CJK 扩展字符）。
 * 关键导出：renderMemorySection, readWithBudget, MEMORY_FILE_BUDGET_CHARS
 * 借鉴：nanoclaw container/agent-runner/src/memory/context.ts
 *
 * 修改记录：
 *   2026-10-06 P1-1：从 scaffold.ts 拆出；OKF v0.1 framing；代理对安全截断
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { memoryDir } from "./scaffold.ts";

export const MEMORY_FILE_BUDGET_CHARS = 16000;
export const MEMORY_TRUNCATION_NOTICE = "memory file exceeds budget; consider slimming";

/**
 * 按码点截断：迭代 code point（不是 UTF-16 单元），预算内不切代理对。
 * 旧实现 `text.slice(0, n)` 可能把 emoji / CJK 扩展字符切成两半（乱码）。
 */
export function truncateAtCodePoint(text: string, budget: number): string {
  if (text.length <= budget) return text;
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > budget) break;
    out += ch;
  }
  return out;
}

export function readWithBudget(path: string): { content: string; truncated: boolean } {
  try {
    const text = readFileSync(path, "utf8");
    if (text.length <= MEMORY_FILE_BUDGET_CHARS) return { content: text, truncated: false };
    return { content: truncateAtCodePoint(text, MEMORY_FILE_BUDGET_CHARS), truncated: true };
  } catch {
    return { content: "", truncated: false };
  }
}

/**
 * OKF v0.1 framing：
 *   <context> 说明性文字（记忆是什么、如何维护）→
 *   <authoritative-file> 权威文件（index）→ <doctrine-file> 维护规则 →
 *   仅当发生截断时输出 <truncation> 说明。
 * 非截断的正常路径不输出 truncation 段（预算省给正文）。
 */
export function renderMemorySection(): string {
  const index = readWithBudget(join(memoryDir(), "index.md"));
  const def = readWithBudget(join(memoryDir(), "system", "definition.md"));
  const truncated = index.truncated || def.truncated;

  const lines: string[] = [];
  lines.push(`<memory version="OKF-0.1">`);
  lines.push(`  <context>`);
  lines.push(`    Below is your persistent memory. The index is authoritative data that maps`);
  lines.push(`    every concept file; the doctrine defines how to maintain it. Facts are`);
  lines.push(`    corrected in place — edit files, never keep duplicate lines.`);
  lines.push(`  </context>`);
  lines.push(`  <authoritative-file path="memory/index.md">`);
  for (const l of index.content.split("\n")) lines.push(`    ${l}`);
  lines.push(`  </authoritative-file>`);
  lines.push(`  <doctrine-file path="memory/system/definition.md">`);
  for (const l of def.content.split("\n")) lines.push(`    ${l}`);
  lines.push(`  </doctrine-file>`);
  if (truncated) {
    lines.push(`  <truncation note="${MEMORY_TRUNCATION_NOTICE}" />`);
  }
  lines.push(`</memory>`);
  return lines.join("\n");
}
