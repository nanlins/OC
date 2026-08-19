/**
 * memory/scaffold.ts —— 记忆系统脚手架（文件即记忆，agent 自治）
 *
 * 职责：幂等搭建 memory/（index.md + system/definition.md，只补缺失永不覆盖）；
 *       renderMemorySection 恒载渲染（16K 预算截断）。
 * 关键导出：ensureMemoryScaffold, renderMemorySection, MEMORY_FILE_BUDGET_CHARS
 * 借鉴：nanoclaw container/agent-runner/src/memory/{scaffold,context}.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getWorkspace } from "../db/connection.ts";

export const MEMORY_FILE_BUDGET_CHARS = 16000;
export const MEMORY_TRUNCATION_NOTICE = "\n[...truncated: memory file exceeds budget; consider slimming]";

const INDEX_TEMPLATE = `---
type: index
---
# Memory Index

## Core Memory
(agent maintained: user preferences / long-term facts)

## Map
(concept file list)
`;

const DEFINITION_TEMPLATE = `# Memory Doctrine

- one file per concept; record patterns not instances; entity-centric; the index is core data.
- facts corrected in place; structure beyond index.md and this file is freely reshaped by the agent.
`;

export function memoryDir(): string {
  return join(getWorkspace(), "agent", "memory");
}

export function ensureMemoryScaffold(): void {
  const dir = memoryDir();
  mkdirSync(join(dir, "system"), { recursive: true });
  const indexPath = join(dir, "index.md");
  if (!existsSync(indexPath)) writeFileSync(indexPath, INDEX_TEMPLATE, { flag: "wx" });
  const defPath = join(dir, "system", "definition.md");
  if (!existsSync(defPath)) writeFileSync(defPath, DEFINITION_TEMPLATE, { flag: "wx" });
}

function readWithBudget(path: string): string {
  try {
    const text = readFileSync(path, "utf8");
    if (text.length <= MEMORY_FILE_BUDGET_CHARS) return text;
    return text.slice(0, MEMORY_FILE_BUDGET_CHARS) + MEMORY_TRUNCATION_NOTICE;
  } catch {
    return "";
  }
}

/** 恒载两个文件：index.md + system/definition.md */
export function renderMemorySection(): string {
  const index = readWithBudget(join(memoryDir(), "index.md"));
  const def = readWithBudget(join(memoryDir(), "system", "definition.md"));
  return [`<memory index>\n${index}\n</memory>`, `<memory doctrine>\n${def}\n</memory>`].join("\n");
}
