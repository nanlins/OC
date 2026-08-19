/**
 * container-config.ts —— container.json 类型 + DB→文件物化 + 组级时区解析
 *
 * 职责：DB 为唯一事实源，文件为运行时投影（spawn 时现写）。
 * 关键导出：ContainerConfig, McpServerConfig, configFromDb, materializeContainerJson, resolveGroupTimezone
 * 承重不变量：resolveGroupTimezone 组覆盖 → 安装全局，非法值回落而非变 UTC。
 * 借鉴：nanoclaw src/container-config.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 *   2026-08-13 收束期修复：configFromDb 以群组 agent_provider 打 provider 戳（实测发现默认 claude 覆盖所选 provider）
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { TIMEZONE } from "./config.js";
import { ensureContainerConfig, getContainerConfig } from "./db/container-configs.js";
import { getAgentGroup } from "./db/agent-groups.js";
import { isValidTimezone } from "./timezone.js";
import { resolveGroupFolderPath } from "./group-folder.js";
import type { AgentGroup } from "./types.js";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface ContainerConfig {
  provider: string;
  assistantName: string | null;
  model: string | null;
  effort: string | null;
  mcpServers: Record<string, McpServerConfig>;
  packages: string[];
  mounts: Array<{ host: string; container: string; readonly?: boolean }>;
  cliScope: "disabled" | "group" | "global";
  timezone: string | null;
  cpuLimit: string | null;
  memoryLimit: string | null;
  pidsLimit: string | null;
}

/** 组时区覆盖 → 安装全局时区；非法值回落（不静默变 UTC，除非全局本身非法） */
export function resolveGroupTimezone(agentGroupId: string): string {
  const row = getContainerConfig(agentGroupId);
  if (row?.timezone && isValidTimezone(row.timezone)) return row.timezone;
  return TIMEZONE;
}

export function configFromDb(agentGroupId: string): ContainerConfig {
  // 收束期修复：ensure 时以群组 agent_provider 打 provider 戳，避免默认 claude 覆盖建组所选 provider
  const group = getAgentGroup(agentGroupId);
  const row = ensureContainerConfig(agentGroupId, group?.agent_provider ?? undefined);
  const parse = <T>(json: string | null, fallback: T): T => {
    if (!json) return fallback;
    try {
      return JSON.parse(json) as T;
    } catch {
      return fallback;
    }
  };
  return {
    provider: row.provider,
    assistantName: row.assistant_name,
    model: row.model,
    effort: row.effort,
    mcpServers: parse(row.mcp_servers, {}),
    packages: parse(row.packages, []),
    mounts: parse(row.mounts, []),
    cliScope: row.cli_scope,
    timezone: row.timezone,
    cpuLimit: row.cpu_limit,
    memoryLimit: row.memory_limit,
    pidsLimit: row.pids_limit,
  };
}

/** spawn 时物化 container.json 到群组文件夹（返回对象贯穿后续，不再重读） */
export function materializeContainerJson(group: AgentGroup): ContainerConfig {
  const config = configFromDb(group.id);
  const path = join(resolveGroupFolderPath(group.folder), "container.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
  return config;
}
