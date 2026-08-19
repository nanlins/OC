/**
 * container-configs.ts —— container_configs 表 CRUD
 *
 * 职责：每 Agent 群组容器运行时配置（DB 为唯一事实源，spawn 时物化为 container.json）。
 * 关键导出：getContainerConfig, ensureContainerConfig, updateContainerConfig
 * 承重不变量：ensure 幂等（INSERT OR IGNORE）；标量列/JSON 列白名单分离更新。
 * 借鉴：nanoclaw src/db/container-configs.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 *   2026-08-12 se-inspector P1-3 修复：ensureContainerConfig 不再覆写既有行 provider（承重语义对齐基线）
 */
import { getDb } from "./connection.js";
import type { ContainerConfigRow } from "../types.js";

export function getContainerConfig(agentGroupId: string): ContainerConfigRow | undefined {
  return getDb().prepare("SELECT * FROM container_configs WHERE agent_group_id = ?").get(agentGroupId) as
    ContainerConfigRow | undefined;
}

/**
 * 幂等打 provider 戳。承重语义（借鉴 nanoclaw src/db/container-configs.ts 明文注释）：
 * INSERT OR IGNORE 保持既有行原样——provider 永不被覆写（P1-3 修复：删除 UPDATE 分支）。
 * 改 provider 走 updateContainerConfig 显式路径。
 */
export function ensureContainerConfig(agentGroupId: string, provider?: string | null): ContainerConfigRow {
  const normalized = provider === "claude" || provider === undefined ? null : provider;
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO container_configs (agent_group_id, provider, assistant_name, model, effort,
        mcp_servers, packages, mounts, cli_scope, timezone, cpu_limit, memory_limit, pids_limit, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 'group', NULL, NULL, NULL, NULL, ?)`,
    )
    .run(agentGroupId, normalized ?? "claude", new Date().toISOString());
  return getContainerConfig(agentGroupId)!;
}

const SCALAR_UPDATABLE = new Set([
  "provider",
  "assistant_name",
  "model",
  "effort",
  "cli_scope",
  "timezone",
  "cpu_limit",
  "memory_limit",
  "pids_limit",
]);
const JSON_UPDATABLE = new Set(["mcp_servers", "packages", "mounts"]);

export function updateContainerConfig(agentGroupId: string, patch: Partial<ContainerConfigRow>): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (SCALAR_UPDATABLE.has(k)) {
      sets.push(`${k} = ?`);
      vals.push(v);
    } else if (JSON_UPDATABLE.has(k)) {
      sets.push(`${k} = ?`);
      vals.push(v == null ? null : JSON.stringify(v));
    } else {
      throw new Error(`not updatable: ${k}`);
    }
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString());
  vals.push(agentGroupId);
  return (
    getDb()
      .prepare(`UPDATE container_configs SET ${sets.join(", ")} WHERE agent_group_id = ?`)
      .run(...vals).changes === 1
  );
}
