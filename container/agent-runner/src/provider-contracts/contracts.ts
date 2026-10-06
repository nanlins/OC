/**
 * provider-contracts/claude.ts / openai.ts / mock.ts —— 三个内建 provider 的合约
 *
 * 职责：为 claude/openai/mock 各声明一份合约——能力面从「核心既有事实」解析
 *       （maxToolRounds=MAX_TOOL_ROUNDS、组时区/模型、工具名单），provider 不自读。
 * 关键导出：claudeContract, openaiContract, mockContract（副作用注册到 registry）
 * 借鉴：nanoclaw container/agent-runner/src/provider-contracts/{claude,openai,mock}.ts
 *
 * 修改记录：2026-10-06 创建（P0-2）
 */
import { MAX_TOOL_ROUNDS } from "../providers/tool-loop.ts";
import { registerContract, type ProviderCapabilities, type ProviderRuntimeContract } from "./registry.ts";

/** 各 provider 的 inference 事实（P0-3 记录在案的已知缺口：openai 未显式 max_tokens）。 */
const PROVIDER_FACTS: Record<string, { defaultModel: string; maxTokens: number | null }> = {
  claude: { defaultModel: "claude-sonnet-4-5", maxTokens: 4096 },
  openai: { defaultModel: "gpt-4o-mini", maxTokens: null },
  ollama: { defaultModel: "llama3", maxTokens: null },
  mock: { defaultModel: "mock", maxTokens: null },
};

function buildContract(name: string): ProviderRuntimeContract {
  return {
    name,
    realize: (provider, ctx) => {
      const facts = PROVIDER_FACTS[name];
      if (!facts) throw new Error(`no provider facts for contract: ${name}`);
      const capabilities: ProviderCapabilities = {
        configuration: {
          executionPolicy: { maxToolRounds: MAX_TOOL_ROUNDS, timezone: ctx.timezone },
          inference: { model: ctx.model ?? facts.defaultModel, maxTokens: facts.maxTokens },
          memory: { sessionStatePrefixes: ["continuation:", "history:"] },
          mcpServers: { toolNames: ctx.toolNames },
          tone: ctx.tone ?? null,
        },
        // P1-1 起记忆会话钩子真实注册（memory/session-hook.ts 经 hook.ts 接入 index.ts）
        lifecycle: { memorySessionHookRegistration: true, beforeQuery: true },
        // claude/openai/mock 每轮 query 后都 setHistory；getContinuationId 读 session_state
        history: { afterExchange: true, readTrace: true },
        // 全部支持流式 progress（mid-turn 增量）+ 最终 result
        textDelivery: { midTurnComplete: true, result: true },
        // OC 无 provider 级命令系统（命令分流在 poll-loop/formatter 的 XML 块），如实声明空名单
        commands: { nativeFormat: "xml", admin: [], filtered: [] },
      };
      return { providerName: provider.name, contractName: name, capabilities };
    },
  };
}

export const claudeContract = buildContract("claude");
export const openaiContract = buildContract("openai");
export const ollamaContract = buildContract("ollama");
export const mockContract = buildContract("mock");

registerContract(claudeContract);
registerContract(openaiContract);
registerContract(ollamaContract);
registerContract(mockContract);
