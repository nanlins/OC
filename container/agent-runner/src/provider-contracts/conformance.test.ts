/**
 * provider-contracts/conformance.test.ts —— openai/claude/mock 三个 provider 的统一行为基线（P0-2）
 *
 * 职责：每个内建 provider 必须通过同一套 conformanceSuite：query 事件流 / push /
 *       continuation / 五面能力解析 + verifier 全绿 / 能力注入 provider。
 *       全部离线（注入 fake SDK client），不烧 token。
 *
 * 修改记录：2026-10-06 创建（P0-2）
 */
import { describe } from "bun:test";
import "../index.ts"; // 副作用：注册 claude/openai/ollama/mock 合约（真实 wiring 同源）
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach } from "bun:test";
import { closeSessionDbsForTest, initTestSessionDb } from "../db/connection.ts";
import { INBOUND_SCHEMA, OUTBOUND_SCHEMA } from "../db/schema.ts";
import { ClaudeProvider } from "../providers/claude.ts";
import { MockProvider } from "../providers/mock.ts";
import { OpenAICompatProvider } from "../providers/openai.ts";
import type { AgentProvider, QueryInput } from "../providers/types.ts";
import type { RunnerConfig } from "../config.ts";
import { conformanceSuite } from "./testing/conformance.ts";
import { verifyRealization } from "./verifier.ts";
import { resolveRealization } from "./realize.ts";
import { listContractNames } from "./registry.ts";
import { expect, it } from "bun:test";

function config(over: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    provider: "openai",
    assistantName: null,
    model: "deepseek-flash",
    effort: null,
    mcpServers: {},
    packages: [],
    mounts: [],
    cliScope: "group",
    timezone: null,
    maxMessagesPerPrompt: 10,
    ...over,
  };
}

const ctxFactory = () => ({ routing: { platformId: null, channelType: null, threadId: null }, assistantName: null });

const query: QueryInput = {
  prompt: "hello",
  routing: { platformId: null, channelType: null, threadId: null },
};

const CTX = { timezone: "UTC", model: "deepseek-flash", toolNames: ["web_search", "kb_search"], tone: null };

// claude/openai provider 读 session_state（getHistory/getContinuation）→ 需要测试会话库
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-pc-"));
  initTestSessionDb(dir, INBOUND_SCHEMA, OUTBOUND_SCHEMA);
});
afterEach(() => {
  closeSessionDbsForTest();
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      Bun.sleepSync(50);
    }
  }
});

function fakeOpenAiClient() {
  return {
    chat: {
      completions: {
        create: async () => ({
          id: "resp-1",
          choices: [{ finish_reason: "stop", message: { content: "hello from openai fake" } }],
        }),
      },
    },
  } as never;
}

function fakeAnthropicClient() {
  return {
    messages: {
      create: async () => ({
        id: "msg_1",
        content: [{ type: "text", text: "hello from claude fake" }],
        stop_reason: "end_turn",
      }),
    },
  } as never;
}

conformanceSuite({
  contractName: "openai",
  factory: () => new OpenAICompatProvider(config(), ctxFactory, fakeOpenAiClient()) as AgentProvider,
  ctx: CTX,
  query,
});

conformanceSuite({
  contractName: "claude",
  factory: () => new ClaudeProvider(config(), ctxFactory, fakeAnthropicClient()) as AgentProvider,
  ctx: CTX,
  query,
});

conformanceSuite({
  contractName: "mock",
  factory: () => new MockProvider() as AgentProvider,
  ctx: CTX,
  query,
});

describe("provider-contracts registry", () => {
  it("registers a contract for every registered provider (claude/openai/ollama/mock)", () => {
    const names = listContractNames();
    for (const expected of ["claude", "openai", "ollama", "mock"]) {
      expect(names).toContain(expected);
    }
  });

  it("resolveRealization for every contract passes the verifier", () => {
    for (const name of listContractNames()) {
      const r = resolveRealization(name, CTX);
      const v = verifyRealization(r);
      expect(v.failures, `${name}: ${v.failures.join("; ")}`).toEqual([]);
    }
  });

  it("unknown contract fails fast (no silent unguarded provider)", () => {
    expect(() => resolveRealization("nope", CTX)).toThrow(/unknown provider contract/);
  });

  it("contract declares the honest openai max_tokens gap as null (not faked)", () => {
    const r = resolveRealization("openai", CTX);
    expect(r.capabilities.configuration.inference.maxTokens).toBeNull();
    const c = resolveRealization("claude", CTX);
    expect(c.capabilities.configuration.inference.maxTokens).toBe(4096);
  });
});
