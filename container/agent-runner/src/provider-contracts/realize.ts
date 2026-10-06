/**
 * provider-contracts/realize.ts —— 合约 realization
 *
 * 职责：realizeProvider 由核心执行——查合约 → 运行 realize → 把能力面注入 provider
 *       （provider.contracts）→ 返回 realization。provider 不自读配置面；
 *       未知合约 fail-fast（拼错 provider 名不得静默失去护栏）。
 * 借鉴：nanoclaw container/agent-runner/src/provider-contracts/realize.ts
 *
 * 修改记录：2026-10-06 创建（P0-2）
 */
import { getContract } from "./registry.ts";
import type { AgentProvider } from "../providers/types.ts";
import type { ProviderRealization, RealizeContext } from "./registry.ts";

/** AgentProvider 的契约注入面（realize 写入，verifier/conformance 读取）。 */
declare module "../providers/types.ts" {
  interface AgentProvider {
    contracts?: ProviderRealization;
  }
}

export function realizeProvider(provider: AgentProvider, contractName: string, ctx: RealizeContext): ProviderRealization {
  const contract = getContract(contractName);
  if (!contract) throw new Error(`unknown provider contract: ${contractName}`);
  const realization = contract.realize(provider, ctx);
  provider.contracts = realization;
  return realization;
}

/** 便捷入口：无契约注入需求时只查解析（不写入 provider）。 */
export function resolveRealization(contractName: string, ctx: RealizeContext): ProviderRealization {
  const contract = getContract(contractName);
  if (!contract) throw new Error(`unknown provider contract: ${contractName}`);
  // 需要一个最小 provider 壳：realize 只用 name
  const shell = { name: contractName } as AgentProvider;
  return contract.realize(shell, ctx);
}
