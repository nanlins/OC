/**
 * provider-contracts/testing/conformance.ts —— provider 行为基线
 *
 * 职责：conformanceSuite(providerName, factory, ctx) 生成一套基线断言：
 *       query 事件流形状、push 消费、continuation、能力面解析+verifier 全绿。
 *       每个 provider（openai/claude/mock）都必须通过同一套基线（P0-2 验收）。
 * 借鉴：nanoclaw container/agent-runner/src/provider-contracts/testing/conformance.ts
 *
 * 修改记录：2026-10-06 创建（P0-2）
 */
import { describe, expect, it } from "bun:test";
import type { AgentProvider, QueryInput } from "../../providers/types.ts";
import { realizeProvider } from "../realize.ts";
import { verifyRealization } from "../verifier.ts";
import type { RealizeContext } from "../registry.ts";

export interface ConformanceInput {
  /** 合约名（claude/openai/mock）。 */
  contractName: string;
  /** provider 工厂（与生产 createProvider 同源）。 */
  factory: () => AgentProvider;
  /** 能力解析上下文（时区/模型/工具名/tone）。 */
  ctx: RealizeContext;
  /** 测试查询输入。 */
  query: QueryInput;
}

/** 从 provider 的 query 流收集全部事件。 */
async function collect(provider: AgentProvider, input: QueryInput): Promise<Array<{ type: string }>> {
  const events: Array<{ type: string }> = [];
  for await (const ev of provider.query(input)) {
    events.push({ type: ev.type });
  }
  return events;
}

export function conformanceSuite(opts: ConformanceInput): void {
  describe(`provider conformance: ${opts.contractName}`, () => {
    it("query yields a valid event stream (activity + result/error, no throw)", async () => {
      const provider = opts.factory();
      const events = await collect(provider, opts.query);
      expect(events.length).toBeGreaterThan(0);
      const types = new Set(events.map((e) => e.type));
      expect(types.has("activity") || types.has("result") || types.has("error")).toBe(true);
    });

    it("push during/after query does not throw", () => {
      const provider = opts.factory();
      expect(() => provider.push("extra context")).not.toThrow();
    });

    it("getContinuationId returns string or null", () => {
      const provider = opts.factory();
      const id = provider.getContinuationId();
      expect(id === null || typeof id === "string").toBe(true);
    });

    it("realization satisfies the verifier across all five facets", () => {
      const provider = opts.factory();
      const r = realizeProvider(provider, opts.contractName, opts.ctx);
      expect(r.providerName).toBe(provider.name);
      const v = verifyRealization(r);
      expect(v.failures, v.failures.join("; ")).toEqual([]);
      expect(v.ok).toBe(true);
    });

    it("capabilities are injected onto the provider (realize injects, provider does not self-read)", () => {
      const provider = opts.factory();
      realizeProvider(provider, opts.contractName, opts.ctx);
      expect(provider.contracts?.contractName).toBe(opts.contractName);
      expect(provider.contracts?.capabilities.configuration).toBeDefined();
      expect(provider.contracts?.capabilities.lifecycle).toBeDefined();
      expect(provider.contracts?.capabilities.history).toBeDefined();
      expect(provider.contracts?.capabilities.textDelivery).toBeDefined();
      expect(provider.contracts?.capabilities.commands).toBeDefined();
    });
  });
}
