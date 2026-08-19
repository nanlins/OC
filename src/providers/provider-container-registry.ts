/**
 * providers/provider-container-registry.ts —— Provider 主机侧容器贡献注册表
 *
 * 职责：provider 在 spawn 时的主机侧准备（额外挂载/env 透传）+ 能力声明。
 * 关键导出：registerProviderContainerConfig, resolveProviderContribution, ProviderContainerContribution
 * 核心模式：重复注册抛错；未注册 provider（含内建 claude 默认）报告无能力，主机照旧。
 * 借鉴：nanoclaw src/providers/provider-container-registry.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import { log } from "../log.js";

export interface VolumeMount {
  host: string;
  container: string;
  readonly?: boolean;
}

export interface ProviderContainerContribution {
  mounts: VolumeMount[];
  env: Record<string, string>;
}

export interface ProviderHostCapabilities {
  /** true = provider 自带 agent 面，主机不得叠加默认 CLAUDE.md 组合 */
  providesAgentSurfaces?: boolean;
}

export interface ProviderContainerContext {
  sessionDir: string;
  agentGroupId: string;
  groupDir: string;
  hostEnv: Record<string, string>;
}

type ContributionFn = (ctx: ProviderContainerContext) => ProviderContainerContribution;

interface Entry {
  fn: ContributionFn;
  capabilities: ProviderHostCapabilities;
}

const registry = new Map<string, Entry>();

export function registerProviderContainerConfig(
  name: string,
  fn: ContributionFn,
  capabilities: ProviderHostCapabilities = {},
): void {
  if (registry.has(name)) throw new Error(`provider container config already registered: ${name}`);
  registry.set(name, { fn, capabilities });
}

export function resolveProviderContribution(
  name: string,
  ctx: ProviderContainerContext,
): ProviderContainerContribution {
  const entry = registry.get(name);
  if (!entry) return { mounts: [], env: {} };
  try {
    return entry.fn(ctx);
  } catch (err) {
    log.warn(`provider contribution failed: ${name}`, { err });
    return { mounts: [], env: {} };
  }
}

export function providerProvidesAgentSurfaces(name: string): boolean {
  return registry.get(name)?.capabilities.providesAgentSurfaces === true;
}

/** 仅供测试 */
export function clearProviderRegistryForTest(): void {
  registry.clear();
}
