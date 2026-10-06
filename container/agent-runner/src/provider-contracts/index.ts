/**
 * provider-contracts/index.ts —— 合约模块出口
 *
 * 职责：副作用注册三个内建合约；再导出 registry/realize/verifier/names/conformance。
 * 借鉴：nanoclaw container/agent-runner/src/provider-contracts/index.ts
 *
 * 修改记录：2026-10-06 创建（P0-2）
 */
export { registerContract, getContract, listContractNames } from "./registry.ts";
export type { ProviderRuntimeContract, ProviderCapabilities, ProviderRealization, RealizeContext } from "./registry.ts";
export { realizeProvider, resolveRealization } from "./realize.ts";
export { verifyRealization, type VerificationResult } from "./verifier.ts";
export { CAPABILITY_FACETS, CONTRACT_NAMES } from "./names.ts";
export type { CapabilityFacet, ContractName } from "./names.ts";
export { conformanceSuite } from "./testing/conformance.ts";
import "./contracts.ts"; // 副作用：注册 claude/openai/mock 合约
