/**
 * templates/parse.ts —— 模板解析
 *
 * 职责：读取模板目录（.mcp.json + context/instructions.md + context/**\/*.md + skills/ + tasks/），
 *       解析为结构化 Template 对象。context/instructions.md 必填。
 * 关键导出：parseTemplate, Template, TemplateTask
 * 借鉴：nanoclaw src/templates/parse.ts（简化：去 yaml 依赖，去 MCP server 校验）
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Template {
  mcpServers: Record<string, unknown>;
  instructions: string;
  contextExtras: { name: string; content: string }[];
  skills: { name: string; srcDir: string }[];
  tasks: TemplateTask[];
}

export interface TemplateTask {
  name: string;
  schedule: string;
  prompt: string;
  source: string;
}

export function parseTemplate(dir: string): Template {
  if (!existsSync(dir)) throw new Error(`Template folder not found: ${dir}`);

  let mcpServers: Record<string, unknown> = {};
  const mcpPath = join(dir, ".mcp.json");
  if (existsSync(mcpPath)) {
    try {
      mcpServers =
        (JSON.parse(readFileSync(mcpPath, "utf-8")) as { mcpServers?: Record<string, unknown> }).mcpServers ?? {};
    } catch {
      /* 忽略无效 .mcp.json */
    }
  }

  const instructionsFile = join(dir, "context", "instructions.md");
  if (!existsSync(instructionsFile)) {
    throw new Error(`Template missing required context/instructions.md: ${dir}`);
  }
  const instructions = readFileSync(instructionsFile, "utf-8").trimEnd();

  return {
    mcpServers,
    instructions,
    contextExtras: readContextExtras(join(dir, "context")),
    skills: readSkills(join(dir, "skills")),
    tasks: readTasks(join(dir, "tasks")),
  };
}

function readContextExtras(contextDir: string): { name: string; content: string }[] {
  if (!existsSync(contextDir)) return [];
  return readdirSync(contextDir, { recursive: true })
    .filter(
      (f) =>
        (f as string).endsWith(".md") && f !== "instructions.md" && statSync(join(contextDir, f as string)).isFile(),
    )
    .map((name) => ({ name: name as string, content: readFileSync(join(contextDir, name as string), "utf-8") }));
}

function readSkills(skillsDir: string): { name: string; srcDir: string }[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .map((name) => ({ name, srcDir: join(skillsDir, name) }))
    .filter(({ srcDir }) => statSync(srcDir).isDirectory());
}

function readTasks(tasksDir: string): TemplateTask[] {
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => parseTaskFile(tasksDir, entry.name));
}

function parseTaskFile(tasksDir: string, file: string): TemplateTask {
  const source = `tasks/${file}`;
  const name = file.replace(".md", "");
  const lines = readFileSync(join(tasksDir, file), "utf-8").split(/\r?\n/);
  if (lines[0] !== "---") throw new Error(`Template task ${source} must start with --- frontmatter`);
  const closing = lines.indexOf("---", 1);
  if (closing === -1) throw new Error(`Template task ${source} is missing the closing ---`);
  const frontmatter = lines.slice(1, closing).join("\n");
  const schedule = frontmatter.match(/schedule:\s*(.+)/)?.[1]?.trim();
  if (!schedule) throw new Error(`Template task ${source} schedule is required`);
  const prompt = lines
    .slice(closing + 1)
    .join("\n")
    .trim();
  if (!prompt) throw new Error(`Template task ${source} prompt is required`);
  return { name, schedule, prompt, source };
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */
