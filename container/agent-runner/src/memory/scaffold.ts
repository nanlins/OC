/**
 * memory/scaffold.ts —— 记忆系统脚手架（文件即记忆，agent 自治）
 *
 * 职责：幂等搭建 memory/（index.md + system/definition.md，只补缺失永不覆盖）。
 *       模板从 memory/templates/ 的**真实文件**读取（P1-1：不再是几行内联简版）。
 * 关键导出：ensureMemoryScaffold, memoryDir
 * 兼容再导出：renderMemorySection / MEMORY_FILE_BUDGET_CHARS（实现已迁到 context.ts）
 * 借鉴：nanoclaw container/agent-runner/src/memory/scaffold.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-10-06 P1-1：模板外置为 memory/templates/ 真实文件；渲染与截断迁至 context.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getWorkspace } from "../db/connection.ts";

export { renderMemorySection, MEMORY_FILE_BUDGET_CHARS } from "./context.ts";

export function memoryDir(): string {
  return join(getWorkspace(), "agent", "memory");
}

function templatesDir(): string {
  // 模板随源码烘焙进镜像；运行时从这里读取（bun 容器内 /app/src/memory/templates/）
  return join(import.meta.dir, "templates");
}

function readTemplate(rel: string): string {
  try {
    return readFileSync(join(templatesDir(), rel), "utf8");
  } catch {
    // 模板文件缺失（不应发生）：回退最小占位，确保脚手架仍幂等
    return `# Memory\n\n(agent maintained)\n`;
  }
}

export function ensureMemoryScaffold(): void {
  const dir = memoryDir();
  mkdirSync(join(dir, "system"), { recursive: true });
  const indexPath = join(dir, "index.md");
  if (!existsSync(indexPath)) writeFileSync(indexPath, readTemplate("index.md"), { flag: "wx" });
  const defPath = join(dir, "system", "definition.md");
  if (!existsSync(defPath)) writeFileSync(defPath, readTemplate(join("system", "definition.md")), { flag: "wx" });
}
