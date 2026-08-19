/**
 * providers/registry.ts —— provider 自注册表
 *
 * 职责：registerProvider/getProviderFactory/listProviderNames；重复注册抛错。
 * 关键导出：registerProvider, getProviderFactory, ProviderFactory
 * 借鉴：nanoclaw container/agent-runner/src/providers/provider-registry.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import type { AgentProvider } from "./types.ts";
import type { RunnerConfig } from "../config.ts";
import type { ToolContext } from "../mcp-tools/registry.ts";
import type { RoutingContext } from "../formatter.ts";

export type ProviderFactory = (config: RunnerConfig, ctxFactory: (routing?: RoutingContext) => ToolContext) => AgentProvider;

const factories = new Map<string, ProviderFactory>();

export function registerProvider(name: string, factory: ProviderFactory): void {
  if (factories.has(name)) throw new Error(`provider already registered: ${name}`);
  factories.set(name, factory);
}

export function getProviderFactory(name: string): ProviderFactory | undefined {
  return factories.get(name);
}

export function listProviderNames(): string[] {
  return [...factories.keys()];
}

/** 仅供测试 */
export function clearProvidersForTest(): void {
  factories.clear();
}
