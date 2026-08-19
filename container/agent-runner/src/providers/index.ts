/**
 * providers/index.ts —— provider 工厂与自注册 barrel
 *
 * 职责：createProvider(name, config, ctxFactory)；barrel 副作用注册 claude/openai/ollama/mock
 *       （ollama 走 OpenAI 兼容协议）。
 * 关键导出：createProvider
 * 借鉴：nanoclaw container/agent-runner/src/providers/{factory,index}.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 ai-inspector 修复：未知 provider 抛错
 */
import type { RunnerConfig } from "../config.ts";
import type { ToolContext } from "../mcp-tools/registry.ts";
import { ClaudeProvider } from "./claude.ts";
import { MockProvider } from "./mock.ts";
import { OpenAICompatProvider } from "./openai.ts";
import { getProviderFactory, listProviderNames, registerProvider } from "./registry.ts";
import type { AgentProvider } from "./types.ts";

registerProvider("claude", (config, ctx) => new ClaudeProvider(config, ctx));
registerProvider("openai", (config, ctx) => new OpenAICompatProvider(config, ctx));
registerProvider("ollama", (config, ctx) => new OpenAICompatProvider(config, ctx, undefined, "ollama"));
registerProvider("mock", () => new MockProvider());

export function createProvider(name: string, config: RunnerConfig, ctxFactory: () => ToolContext): AgentProvider {
  const factory = getProviderFactory(name);
  // P1-6 修复：未知 provider 抛错（拼错配置不得静默变 echo 机器人）
  if (!factory) throw new Error(`unknown provider: ${name} (registered: ${listProviderNames().join(", ")})`);
  return factory(config, ctxFactory);
}

export { registerProvider, getProviderFactory, listProviderNames } from "./registry.ts";
export type { AgentProvider, ProviderEvent, QueryInput } from "./types.ts";
