/**
 * providers/types.ts —— 主机侧 Provider 类型定义
 *
 * 职责：定义 Provider 容器贡献接口、Provider 实例接口。模块间共享类型。
 * 关键导出：HostAgentProvider, ProviderConfig
 * 借鉴：nanoclaw src/providers/ 的类型定义
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import type { VolumeMount } from "./provider-container-registry.js";

export interface ProviderConfig {
  /** Provider 名称（claude | openai | ollama | mock） */
  name: string;
  /** 容器侧 provider 模块路径 */
  modulePath: string;
  /** 默认模型 */
  defaultModel: string;
  /** 是否支持流式输出 */
  supportsStreaming: boolean;
}

export interface HostAgentProvider {
  readonly name: string;
  readonly config: ProviderConfig;
  /** 获取容器侧环境变量注入 */
  getEnv(): Record<string, string>;
  /** 获取额外挂载 */
  getMounts(): VolumeMount[];
}

/** 预定义的 Provider 配置 */
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    name: "claude",
    modulePath: "/app/src/providers/claude.ts",
    defaultModel: "claude-sonnet-4-20250514",
    supportsStreaming: true,
  },
  openai: {
    name: "openai",
    modulePath: "/app/src/providers/openai.ts",
    defaultModel: "gpt-4o",
    supportsStreaming: true,
  },
  ollama: {
    name: "ollama",
    modulePath: "/app/src/providers/ollama.ts",
    defaultModel: "llama3.1",
    supportsStreaming: true,
  },
  mock: {
    name: "mock",
    modulePath: "/app/src/providers/mock.ts",
    defaultModel: "mock",
    supportsStreaming: true,
  },
};
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */
