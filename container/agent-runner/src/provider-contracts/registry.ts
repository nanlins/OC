/**
 * provider-contracts/registry.ts —— 合约注册表
 *
 * 职责：registerContract / getContract / listContractNames。合约描述一个 provider 的
 *       能力面如何解析（realize 由核心执行，provider 不自读）。
 * 借鉴：nanoclaw container/agent-runner/src/provider-contracts/registry.ts
 *
 * 修改记录：2026-10-06 创建（P0-2）
 */
import type { AgentProvider } from "../providers/types.ts";

/** realize 上下文：核心在解析能力时注入的既有事实。 */
export interface RealizeContext {
  /** 组时区（RunnerConfig.timezone 已解析）。 */
  timezone: string;
  /** 组配置模型名（可能未设置）。 */
  model: string | null;
  /** 当前注册的全部 MCP 工具名（mcpServers 能力面）。 */
  toolNames: string[];
  /** 组 tone 配置（OC 尚无 tone 配置面，恒 null——如实声明）。 */
  tone: string | null;
}

/** 能力面（五个维度，P0-2 要求全部覆盖）。 */
export interface ProviderCapabilities {
  configuration: {
    executionPolicy: { maxToolRounds: number; timezone: string };
    inference: { model: string; maxTokens: number | null };
    memory: { sessionStatePrefixes: string[] };
    mcpServers: { toolNames: string[] };
    tone: string | null;
  };
  lifecycle: {
    memorySessionHookRegistration: boolean;
    beforeQuery: boolean;
  };
  history: {
    afterExchange: boolean;
    readTrace: boolean;
  };
  textDelivery: {
    midTurnComplete: boolean;
    result: boolean;
  };
  commands: {
    /** 命令呈现格式：OC 统一走 XML 块（formatter），无 native 命令面。 */
    nativeFormat: "xml" | "native";
    admin: string[];
    filtered: string[];
  };
}

/** 合约解析结果：能力面 + 提供者身份。 */
export interface ProviderRealization {
  providerName: string;
  contractName: string;
  capabilities: ProviderCapabilities;
}

export interface ProviderRuntimeContract {
  name: string;
  /** 核心解析能力并注入 provider（provider 不自读配置面）。 */
  realize: (provider: AgentProvider, ctx: RealizeContext) => ProviderRealization;
}

const contracts = new Map<string, ProviderRuntimeContract>();

export function registerContract(contract: ProviderRuntimeContract): void {
  if (contracts.has(contract.name)) throw new Error(`provider contract already registered: ${contract.name}`);
  contracts.set(contract.name, contract);
}

export function getContract(name: string): ProviderRuntimeContract | undefined {
  return contracts.get(name);
}

export function listContractNames(): string[] {
  return [...contracts.keys()].sort();
}
