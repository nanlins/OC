/**
 * providers/factory.ts —— 主机侧 Provider 工厂
 *
 * 职责：按名称解析 ProviderConfig，供主机侧 spawn 时查询 provider 元信息。
 *       返回 defaultModel / supportsStreaming / modulePath 等容器侧配置决策所需数据。
 * 关键导出：resolveProviderConfig, listProviderNames
 * 借鉴：nanoclaw src/providers/ 的工厂模式
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { PROVIDER_CONFIGS, type ProviderConfig } from "./types.js";

export function resolveProviderConfig(name: string): ProviderConfig | undefined {
  return PROVIDER_CONFIGS[name];
}

export function listProviderNames(): string[] {
  return Object.keys(PROVIDER_CONFIGS);
}

export function getDefaultModel(name: string): string {
  return PROVIDER_CONFIGS[name]?.defaultModel ?? "claude-sonnet-4-20250514";
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */
