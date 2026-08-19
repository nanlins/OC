/**
 * webhook-generic.test.ts —— 通用 Webhook 通道适配器集成测试（纯本地 mock，不连外网）
 *
 * 职责：parseWebhookPayload 两形态（通用 JSON / GitHub push）与无效拒绝；handleWebhookPayload 路由表门控；
 *       ingest 转发 onInbound；deliver POST WEBHOOK_OUT_URL 断言；凭据缺失 factory 返回 null。
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createWebhookAdapter,
  handleWebhookPayload,
  ingestWebhookPayload,
  parseWebhookPayload,
  registerWebhookChannel,
  registerWebhookRoute,
} from "../../src/channels/webhook-generic.js";
import {
  clearChannelRegistryForTest,
  getActiveAdapters,
  initChannelAdapters,
} from "../../src/channels/channel-registry.js";
import type { ChannelSetup, InboundMessage } from "../../src/channels/adapter.js";

beforeEach(() => clearChannelRegistryForTest());
afterEach(() => clearChannelRegistryForTest());

describe("webhook-generic adapter", () => {
  it("parseWebhookPayload accepts generic {text, sender, channel} shape", () => {
    const msg = parseWebhookPayload({ text: "deploy now", sender: "alice", channel: "ops" });
    expect(msg).toMatchObject({
      content: "deploy now",
      senderId: "webhook:alice",
      senderName: "alice",
      isMention: true,
      isGroup: false,
      kind: "chat",
    });
  });

  it("parseWebhookPayload accepts GitHub push shape (commits[0].message)", () => {
    const msg = parseWebhookPayload({
      ref: "refs/heads/main",
      commits: [
        { id: "c-123", message: "fix: typo in readme" },
        { id: "c-124", message: "second commit" },
      ],
      sender: { login: "octocat" },
    });
    expect(msg).toMatchObject({ content: "fix: typo in readme", id: "c-123", senderId: "webhook:github:octocat" });
  });

  it("parseWebhookPayload rejects unknown or empty bodies", () => {
    expect(parseWebhookPayload({ foo: 1 })).toBeNull();
    expect(parseWebhookPayload("text")).toBeNull();
    expect(parseWebhookPayload(null)).toBeNull();
    expect(parseWebhookPayload({ commits: [] })).toBeNull();
  });

  it("handleWebhookPayload only accepts registered routes", () => {
    registerWebhookRoute("/hooks/in");
    expect(handleWebhookPayload("/hooks/in", { text: "hi", sender: "a" })?.content).toBe("hi");
    expect(handleWebhookPayload("hooks/in", { text: "hi", sender: "a" })?.content).toBe("hi");
    expect(handleWebhookPayload("/not-registered", { text: "hi" })).toBeNull();
  });

  it("ingestWebhookPayload forwards routed payload to active adapter onInbound", async () => {
    const received: Array<{ platformId: string; message: InboundMessage }> = [];
    const cfg: ChannelSetup = {
      onInbound: (platformId, _threadId, message) => received.push({ platformId, message }),
      onInboundEvent: () => {},
      onMetadata: () => {},
      onAction: () => {},
    };
    const adapter = createWebhookAdapter({ outUrl: "https://hooks.example/out" });
    adapter.setup(cfg);
    registerWebhookRoute("/hooks/room");
    const msg = ingestWebhookPayload("/hooks/room", { text: "ping", sender: "bob", channel: "room1" });
    expect(msg?.content).toBe("ping");
    expect(received).toHaveLength(1);
    expect(received[0]!.platformId).toBe("room1");
    await adapter.teardown?.();
    expect(ingestWebhookPayload("/hooks/room", { text: "after teardown" })).not.toBeNull();
    expect(received).toHaveLength(1);
  });

  it("deliver POSTs payload to outUrl", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const impl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const adapter = createWebhookAdapter({ outUrl: "https://hooks.example/out", fetchImpl: impl });
    await adapter.deliver("ops-room", null, { kind: "chat", content: "done" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://hooks.example/out");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ text: "done", channel: "ops-room" });
  });

  it("factory returns null when WEBHOOK_OUT_URL missing", async () => {
    registerWebhookChannel();
    await initChannelAdapters(() => ({
      onInbound: () => {},
      onInboundEvent: () => {},
      onMetadata: () => {},
      onAction: () => {},
    }));
    expect(getActiveAdapters().some((a) => a.channelType === "webhook")).toBe(false);
  });
});
