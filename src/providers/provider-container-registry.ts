/**
 * providers/provider-container-registry.ts —— Provider 主机侧容器贡献注册表
 *
 * 职责：provider 在 spawn 时的主机侧准备（额外挂载 / env 透传）。
 * 关键导出：registerProviderContainerConfig, resolveProviderContribution,
 *           ProviderContainerContribution, VolumeMount, ProviderContainerContext
 * 核心模式：重复注册抛错；未注册 provider 报告无能力（空贡献），主机照旧。
 * 承重不变量：贡献函数返回的 env 不得含真实密钥——密钥经 llm-proxy 在网络边界注入
 *           （见 src/llm-proxy.ts 与 providers/openai.ts、providers/claude.ts）。
 * 借鉴：nanoclaw src/providers/provider-container-registry.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 *   2026-10-06 P2-1：删除 providerProvidesAgentSurfaces 与整套 capabilities 机制
 *              （无任何 provider 声明过 capabilities，也无任何调用方读取——留着就是
 *              "只写不读"的假状态）；删除从未被使用的 clearProviderRegistryForTest
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

export interface ProviderContainerContext {
  sessionDir: string;
  agentGroupId: string;
  groupDir: string;
  hostEnv: Record<string, string>;
}

type ContributionFn = (ctx: ProviderContainerContext) => ProviderContainerContribution;

const registry = new Map<string, ContributionFn>();

export function registerProviderContainerConfig(name: string, fn: ContributionFn): void {
  if (registry.has(name)) throw new Error(`provider container config already registered: ${name}`);
  registry.set(name, fn);
}

export function resolveProviderContribution(
  name: string,
  ctx: ProviderContainerContext,
): ProviderContainerContribution {
  const fn = registry.get(name);
  if (!fn) return { mounts: [], env: {} };
  try {
    return fn(ctx);
  } catch (err) {
    log.warn(`provider contribution failed: ${name}`, { err });
    return { mounts: [], env: {} };
  }
}

/*
 * 修改记录：
 *   2026-10-06 P2-1：删除死的 capabilities 机制与 clearProviderRegistryForTest
 */
