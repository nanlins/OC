/**
 * config.ts —— 容器配置加载（/workspace/agent/container.json，宿主写入、RO 挂载）
 *
 * 职责：loadConfig/getConfig；配置走文件不走环境变量；单例缓存。
 * 关键导出：loadConfig, getConfig, RunnerConfig
 * 借鉴：nanoclaw container/agent-runner/src/config.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getWorkspace } from "./db/connection.ts";

export interface RunnerConfig {
  provider: string;
  assistantName: string | null;
  model: string | null;
  effort: string | null;
  mcpServers: Record<string, unknown>;
  packages: string[];
  mounts: Array<{ host: string; container: string; readonly?: boolean }>;
  cliScope: "disabled" | "group" | "global";
  timezone: string | null;
  maxMessagesPerPrompt: number;
}

let cached: RunnerConfig | null = null;

export function loadConfig(): RunnerConfig {
  const path = join(getWorkspace(), "agent", "container.json");
  let raw: Partial<RunnerConfig> = {};
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as Partial<RunnerConfig>;
  } catch {
    raw = {};
  }
  cached = {
    provider: raw.provider ?? "claude",
    assistantName: raw.assistantName ?? null,
    model: raw.model ?? null,
    effort: raw.effort ?? null,
    mcpServers: raw.mcpServers ?? {},
    packages: raw.packages ?? [],
    mounts: raw.mounts ?? [],
    cliScope: raw.cliScope ?? "group",
    timezone: raw.timezone ?? null,
    maxMessagesPerPrompt: 10,
  };
  return cached;
}

export function getConfig(): RunnerConfig {
  return cached ?? loadConfig();
}

/** 仅供测试 */
export function resetConfigForTest(): void {
  cached = null;
}
