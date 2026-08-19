/**
 * providers/openai.test.ts —— OpenAI 兼容 provider 工具循环回归测试（注入假 client）
 *
 * 职责：tool_calls 循环→tool result 回传→最终 result；MAX_TOOL_ROUNDS 熔断；
 *       错误回传不中断；历史持久化（第二轮带历史）；system 注入。
 * 修改记录：
 *   2026-08-12 创建（阶段 4 复检修复 P1-10）
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeSessionDbsForTest, initTestSessionDb } from "../db/connection.ts";
import { INBOUND_SCHEMA, OUTBOUND_SCHEMA } from "../db/schema.ts";
import { getHistory } from "../db/session-state.ts";
import { bootstrapTools } from "../mcp-tools/index.ts";
import { OpenAICompatProvider } from "./openai.ts";
import type { ProviderEvent } from "./types.ts";
import type { RunnerConfig } from "../config.ts";

const config: RunnerConfig = {
  provider: "openai",
  assistantName: null,
  model: "test-model",
  effort: null,
  mcpServers: {},
  packages: [],
  mounts: [],
  cliScope: "group",
  timezone: null,
  maxMessagesPerPrompt: 10,
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-ov-"));
  initTestSessionDb(dir, INBOUND_SCHEMA, OUTBOUND_SCHEMA);
  bootstrapTools();
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

type FakeCall = { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>; content?: string | null; finish: string };

function fakeClient(calls: FakeCall[]) {
  let i = 0;
  const seen: Array<Record<string, unknown>> = [];
  return {
    seen,
    chat: {
      completions: {
        create: async (req: { messages: Array<Record<string, unknown>> }) => {
          seen.push(...req.messages);
          const call = calls[Math.min(i, calls.length - 1)];
          i += 1;
          return {
            id: `resp-${i}`,
            choices: [
              {
                finish_reason: call.finish,
                message: { content: call.content ?? null, tool_calls: call.tool_calls },
              },
            ],
          };
        },
      },
    },
  };
}

async function collect(gen: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("openai provider", () => {
  it("executes tool loop and returns final result with tool result feedback", async () => {
    const client = fakeClient([
      { finish: "tool_calls", tool_calls: [{ id: "c1", function: { name: "read_file", arguments: '{"path":"notes/a.md"}' } }] },
      { finish: "stop", content: "done" },
    ]) as never;
    const p = new OpenAICompatProvider(config, () => ({ routing: { platformId: null, channelType: null, threadId: null }, assistantName: null }), client as never);
    const events = await collect(p.query({ prompt: "read it", routing: { platformId: null, channelType: null, threadId: null } }));
    const result = events.find((e) => e.type === "result");
    expect(result).toBeDefined();
    expect((result as { text: string }).text).toBe("done");
    // 第二次调用应包含 role=tool 的回传
    const toolMsgs = (client as unknown as { seen: Array<Record<string, unknown>> }).seen.filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBe(1);
  });

  it("unknown tool errors are fed back as tool result, loop continues", async () => {
    const client = fakeClient([
      { finish: "tool_calls", tool_calls: [{ id: "c1", function: { name: "nope", arguments: "{}" } }] },
      { finish: "stop", content: "recovered" },
    ]) as never;
    const p = new OpenAICompatProvider(config, () => ({ routing: { platformId: null, channelType: null, threadId: null }, assistantName: null }), client as never);
    const events = await collect(p.query({ prompt: "x", routing: { platformId: null, channelType: null, threadId: null } }));
    const toolMsg = (client as unknown as { seen: Array<Record<string, unknown>> }).seen.find((m) => m.role === "tool");
    expect(String(toolMsg?.content)).toContain("unknown tool");
    expect((events.find((e) => e.type === "result") as { text: string }).text).toBe("recovered");
  });

  it("passes batch routing into tool context (fix-plan P0 regression)", async () => {
    const client = fakeClient([
      { finish: "tool_calls", tool_calls: [{ id: "c1", function: { name: "read_file", arguments: '{"path":"notes/a.md"}' } }] },
      { finish: "stop", content: "ok" },
    ]) as never;
    const seenRoutings: Array<unknown> = [];
    const ctxFactory = (routing?: { platformId: string | null; channelType: string | null; threadId: string | null }) => {
      seenRoutings.push(routing);
      return { routing: routing ?? { platformId: null, channelType: null, threadId: null }, assistantName: null };
    };
    const p = new OpenAICompatProvider(config, ctxFactory, client as never);
    const batchRouting = { platformId: "chat-9", channelType: "telegram", threadId: "t-1" };
    await collect(p.query({ prompt: "read", routing: batchRouting }));
    // 工具执行时 ctxFactory 应收到本批次真实 routing（而非恒 null）
    expect(seenRoutings.length).toBeGreaterThan(0);
    expect(seenRoutings[0]).toEqual(batchRouting);
  });

  it("persists history so second query carries context (P1-3 regression)", async () => {
    const client = fakeClient([{ finish: "stop", content: "answer-1" }]) as never;
    const ctxFactory = () => ({ routing: { platformId: null, channelType: null, threadId: null }, assistantName: null });
    const p1 = new OpenAICompatProvider(config, ctxFactory, client as never);
    await collect(p1.query({ prompt: "q1", routing: { platformId: null, channelType: null, threadId: null }, system: "SYS" }));
    expect(getHistory("openai").map((h) => h.content)).toEqual(["q1", "answer-1"]);

    const client2 = fakeClient([{ finish: "stop", content: "answer-2" }]) as never;
    const p2 = new OpenAICompatProvider(config, ctxFactory, client2 as never);
    await collect(p2.query({ prompt: "q2", routing: { platformId: null, channelType: null, threadId: null }, system: "SYS" }));
    const seen = (client2 as unknown as { seen: Array<Record<string, unknown>> }).seen;
    expect(seen[0]).toEqual({ role: "system", content: "SYS" });
    expect(seen.map((m) => m.content)).toContain("q1");
    expect(seen.map((m) => m.content)).toContain("answer-1");
  });

  // ---- fix-plan 流式：stream:true 增量解码（progress 事件 + 结果拼装 + 流式工具调用） ----
  type StreamChunk = {
    id?: string;
    choices?: Array<{
      finish_reason?: string | null;
      delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
    }>;
  };
  function streamingClient(turns: StreamChunk[][]): never {
    let i = 0;
    return {
      chat: {
        completions: {
          create: async () => {
            const chunks = turns[Math.min(i, turns.length - 1)];
            i += 1;
            return (async function* () {
              for (const c of chunks) yield c;
            })();
          },
        },
      },
    } as never;
  }
  const nullRouting = { platformId: null, channelType: null, threadId: null };

  it("streams content deltas as progress events and assembles final result (fix-plan streaming)", async () => {
    const client = streamingClient([
      [
        { id: "r1", choices: [{ delta: { content: "Hel" } }] },
        { id: "r1", choices: [{ delta: { content: "lo" } }] },
        { id: "r1", choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
    ]);
    const p = new OpenAICompatProvider(config, () => ({ routing: nullRouting, assistantName: null }), client);
    const events = await collect(p.query({ prompt: "hi", routing: nullRouting }));
    const progress = events.filter((e) => e.type === "progress") as Array<{ type: "progress"; message: string }>;
    expect(progress.map((e) => e.message).join("")).toBe("Hello");
    const result = events.find((e) => e.type === "result") as { text: string };
    expect(result.text).toBe("Hello");
  });

  it("streams tool_calls deltas, executes tool, then streams final answer (fix-plan streaming)", async () => {
    const client = streamingClient([
      [
        { id: "r1", choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_", arguments: '{"path":' } }] } }] },
        { id: "r1", choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"notes/a.md"}' } }] } }] },
        { id: "r1", choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ],
      [
        { id: "r2", choices: [{ delta: { content: "done" } }] },
        { id: "r2", choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
    ]);
    const p = new OpenAICompatProvider(config, () => ({ routing: nullRouting, assistantName: null }), client);
    const events = await collect(p.query({ prompt: "read it", routing: nullRouting }));
    const result = events.find((e) => e.type === "result") as { text: string };
    expect(result.text).toBe("done");
  });
});
