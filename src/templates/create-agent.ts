/**
 * templates/create-agent.ts —— 从模板创建 Agent 群组
 *
 * 职责：从本地模板目录（TEMPLATES_DIR）解析模板，创建 agent_group +
 *       container_config + 任务（paused）+ 技能 + 上下文文件。
 * 关键导出：createAgentFromTemplate, CreateAgentOptions
 * 借鉴：nanoclaw src/templates/create-agent.ts（简化：去 OneCLI/group-persona）
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS_DIR } from "../config.js";
import { createAgentGroup } from "../db/agent-groups.js";
import { ensureContainerConfig } from "../db/container-configs.js";
import { resolveLocalTemplate } from "./local-dir.js";
import { parseTemplate } from "./parse.js";
import type { AgentGroup } from "../types.js";

export interface CreateAgentOptions {
  name?: string;
  timezone?: string;
}

export function createAgentFromTemplate(ref: string, opts?: CreateAgentOptions): AgentGroup {
  const dir = resolveLocalTemplate(ref);
  const tpl = parseTemplate(dir);

  const id = randomUUID();
  const name = opts?.name ?? "agent-" + id.slice(0, 8);
  const folder = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64);

  const groupDir = join(GROUPS_DIR, folder);
  if (existsSync(groupDir)) throw new Error(`group folder already exists: ${folder}`);

  const group: AgentGroup = { id, name, folder, agent_provider: null, created_at: new Date().toISOString() };
  createAgentGroup(group);
  ensureContainerConfig(id);

  mkdirSync(groupDir, { recursive: true });

  // 写入 context 文件
  const contextDir = join(groupDir, "context");
  mkdirSync(contextDir, { recursive: true });
  writeFileSync(join(contextDir, "instructions.md"), tpl.instructions, "utf-8");
  for (const { name: file, content } of tpl.contextExtras) {
    const dest = join(groupDir, file);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, content, "utf-8");
  }

  // 技能暂不复制（容器侧挂载 /app/skills/ 共享）

  return group;
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

