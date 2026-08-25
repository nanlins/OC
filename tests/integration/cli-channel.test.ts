/**
 * cli-channel.test.ts —— CLI 通道适配器集成测试（真实 socket 回环）
 *
 * 职责：setup 监听 → 客户端发 JSON 行 → onInbound 收到；deliver → 客户端收到 JSON 行；teardown 清理。
 * 修改记录：
 *   2026-08-12 创建（阶段 5）
 *   2026-08-12 修复：deliver 用例等待服务端 connection 注册（竞态）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { connect, type Socket } from "node:net";
import { closeDb, initTestDb } from "../../src/db/index.js";
import {
  initChannelAdapters,
  teardownChannelAdapters,
  getChannelAdapterExact,
} from "../../src/channels/channel-registry.js";
import { cliSocketPath } from "../../src/channels/cli.js";
import type { InboundMessage } from "../../src/channels/adapter.js";

let received: InboundMessage[] = [];

beforeEach(async () => {
  initTestDb();
  received = [];
  await initChannelAdapters(() => ({
    onInbound: (_p, _t, message) => {
      received.push(message);
    },
    onInboundEvent: () => {},
    onMetadata: () => {},
    onAction: () => {},
  }));
});

afterEach(async () => {
  await teardownChannelAdapters();
  closeDb();
});

function connectClient(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(cliSocketPath(), () => resolve(s));
    s.on("error", reject);
  });
}

describe("cli channel", () => {
  it("receives JSON lines as inbound messages", async () => {
    const client = await connectClient();
    client.write(JSON.stringify({ text: "hello agent" }) + "\n");
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(1);
    expect(received[0]!.content).toBe("hello agent");
    client.destroy();
  });

  it("accepts plain text lines (fallback)", async () => {
    const client = await connectClient();
    client.write("plain hello\n");
    await new Promise((r) => setTimeout(r, 200));
    expect(received.map((m) => m.content)).toContain("plain hello");
    client.destroy();
  });

  it("deliver writes JSON lines to connected clients", async () => {
    const client = await connectClient();
    let got = "";
    client.on("data", (c) => {
      got += c.toString();
    });
    await new Promise((r) => setTimeout(r, 150)); // 等服务端 connection 注册完成
    const adapter = getChannelAdapterExact("cli");
    expect(adapter).toBeDefined();
    await adapter!.deliver("local", null, { kind: "chat", content: "agent says hi" });
    await new Promise((r) => setTimeout(r, 200));
    const first = got.trim().split("\n")[0]!;
    expect(JSON.parse(first).text).toBe("agent says hi");
    client.destroy();
  });

  it("deliver emits meta + chat + end frames in order (阶段 12 TUI 协议)", async () => {
    const client = await connectClient();
    let got = "";
    client.on("data", (c) => {
      got += c.toString();
    });
    await new Promise((r) => setTimeout(r, 150));
    const adapter = getChannelAdapterExact("cli");
    await adapter!.deliver("local", null, {
      kind: "chat",
      content: "hi",
      meta: { agent: "g1", model: "deepseek-chat", provider: "openai" },
    });
    await new Promise((r) => setTimeout(r, 200));
    const frames = got
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { kind?: string; text?: string });
    expect(frames.map((f) => f.kind)).toEqual(["meta", "chat", "end"]);
    expect(frames[1]!.text).toBe("hi");
    expect(frames[0]!.kind).toBe("meta");
    client.destroy();
  });

  it("notifyTool broadcasts tool frame to clients (阶段 12)", async () => {
    const client = await connectClient();
    let got = "";
    client.on("data", (c) => {
      got += c.toString();
    });
    await new Promise((r) => setTimeout(r, 150));
    const adapter = getChannelAdapterExact("cli");
    adapter!.notifyTool!("web_search", "running");
    adapter!.notifyTool!("web_search", "done", 2100);
    await new Promise((r) => setTimeout(r, 200));
    const frames = got
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { kind?: string; tool?: string; status?: string });
    expect(frames.map((f) => f.kind)).toEqual(["tool", "tool"]);
    expect(frames[0]).toMatchObject({ tool: "web_search", status: "running" });
    expect(frames[1]).toMatchObject({ status: "done", elapsedMs: 2100 });
    client.destroy();
  });
});

/**
 * 修改记录：
 *   2026-08-25 阶段 12：CLI 渲染纯函数测试 + 帧协议集成测试
 */

