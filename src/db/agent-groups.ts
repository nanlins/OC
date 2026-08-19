/**
 * agent-groups.ts —— agent_groups 表 CRUD
 *
 * 职责：Agent 工作区（文件夹/人格/容器配置载体）的增删改查。
 * 关键导出：createAgentGroup, getAgentGroup, getAgentGroupByFolder, listAgentGroups, updateAgentGroup, deleteAgentGroup
 * 借鉴：nanoclaw src/db/agent-groups.ts（动态 SET 子句更新模式）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 */
import { randomUUID } from "node:crypto";
import { getDb } from "./connection.js";
import type { AgentGroup } from "../types.js";

export function createAgentGroup(opts: { name: string; folder: string; agentProvider?: string }): AgentGroup {
  const row: AgentGroup = {
    id: randomUUID(),
    name: opts.name,
    folder: opts.folder,
    agent_provider: opts.agentProvider ?? null,
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare("INSERT INTO agent_groups (id, name, folder, agent_provider, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, row.name, row.folder, row.agent_provider, row.created_at);
  return row;
}

export function getAgentGroup(id: string): AgentGroup | undefined {
  return getDb().prepare("SELECT * FROM agent_groups WHERE id = ?").get(id) as AgentGroup | undefined;
}

export function getAgentGroupByFolder(folder: string): AgentGroup | undefined {
  return getDb().prepare("SELECT * FROM agent_groups WHERE folder = ?").get(folder) as AgentGroup | undefined;
}

export function listAgentGroups(): AgentGroup[] {
  return getDb().prepare("SELECT * FROM agent_groups ORDER BY created_at").all() as AgentGroup[];
}

const UPDATABLE = new Set(["name", "agent_provider"] as const);

export function updateAgentGroup(id: string, patch: Partial<Pick<AgentGroup, "name" | "agent_provider">>): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!UPDATABLE.has(k as keyof typeof patch)) throw new Error(`not updatable: ${k}`);
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return false;
  vals.push(id);
  const r = getDb()
    .prepare(`UPDATE agent_groups SET ${sets.join(", ")} WHERE id = ?`)
    .run(...vals);
  return r.changes === 1;
}

/** 级联删除依赖 FK ON DELETE CASCADE（wirings/sessions/configs/members/roles） */
export function deleteAgentGroup(id: string): boolean {
  return getDb().prepare("DELETE FROM agent_groups WHERE id = ?").run(id).changes === 1;
}
