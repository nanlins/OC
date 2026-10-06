/**
 * provider-contracts/names.ts —— 能力面与合约名常量
 *
 * 职责：把"能力面"（configuration/lifecycle/history/textDelivery/commands）与
 *       合约名统一收口，verifier 与 conformance 共用，不散落魔法字符串。
 * 借鉴：nanoclaw container/agent-runner/src/provider-contracts/names.ts
 *
 * 修改记录：2026-10-06 创建（P0-2：provider-contracts 网关合约）
 */

/** 能力面：ProviderRuntimeContract 声明的五个维度。 */
export const CAPABILITY_FACETS = ["configuration", "lifecycle", "history", "textDelivery", "commands"] as const;
export type CapabilityFacet = (typeof CAPABILITY_FACETS)[number];

export const CONTRACT_NAMES = {
  claude: "claude",
  openai: "openai",
  mock: "mock",
} as const;
export type ContractName = (typeof CONTRACT_NAMES)[keyof typeof CONTRACT_NAMES];
