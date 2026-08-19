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
    expect(JSON.parse(got.trim()).text).toBe("agent says hi");
    client.destroy();
  });
});
