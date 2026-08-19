/**
 * discord.test.ts —— Discord 适配器测试（ws/fetch 注入，纯本地）
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { describe, expect, it } from "vitest";
import { createDiscordAdapter, type WebSocketLike } from "../../src/channels/discord.js";

class FakeWs implements WebSocketLike {
  sent: string[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.();
  }
  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function mockFetch(routes: Array<{ match: (url: string) => boolean; body: unknown; ok?: boolean }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const route = routes.find((r) => r.match(u));
    return {
      ok: route?.ok ?? true,
      status: route?.ok === false ? 403 : 200,
      json: async () => route?.body ?? {},
    } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

describe("discord adapter", () => {
  it("identifies with intents on open and heartbeats on hello", async () => {
    const ws = new FakeWs();
    const { impl } = mockFetch([{ match: (u) => u.includes("@me"), body: { id: "BOT" } }]);
    const adapter = createDiscordAdapter({ token: "D", wsFactory: () => ws, fetchImpl: impl });
    adapter.setup({ onInbound: () => {}, onInboundEvent: () => {}, onMetadata: () => {}, onAction: () => {} });
    await new Promise((r) => setTimeout(r, 10));
    ws.emit({ op: 10, d: { heartbeat_interval: 60000 } });
    await new Promise((r) => setTimeout(r, 10));
    const identify = JSON.parse(ws.sent[0] ?? "{}") as { op: number; d: { token: string; intents: number } };
    expect(identify.op).toBe(2);
    expect(identify.d.token).toBe("Bot D");
    expect(identify.d.intents).toBeGreaterThan(0);
    await adapter.teardown?.();
  });

  it("MESSAGE_CREATE dispatches inbound with thread detection", async () => {
    const ws = new FakeWs();
    const { impl } = mockFetch([{ match: (u) => u.includes("@me"), body: { id: "BOT" } }]);
    const received: Array<{
      platformId: string;
      threadId: string | null;
      msg: { isGroup: boolean; isMention: boolean };
    }> = [];
    const adapter = createDiscordAdapter({ token: "D", wsFactory: () => ws, fetchImpl: impl });
    adapter.setup({
      onInbound: (p, t, m) =>
        received.push({
          platformId: p,
          threadId: t,
          msg: { isGroup: m.isGroup ?? false, isMention: m.isMention ?? false },
        }),
      onInboundEvent: () => {},
      onMetadata: () => {},
      onAction: () => {},
    });
    await new Promise((r) => setTimeout(r, 10));
    ws.emit({
      op: 0,
      t: "MESSAGE_CREATE",
      d: {
        id: "m1",
        content: "hi",
        channel_id: "C1",
        guild_id: "G1",
        type: 11,
        author: { id: "U1", username: "u" },
        mentions: [{ id: "BOT" }],
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(received.length).toBe(1);
    expect(received[0]!.platformId).toBe("G1"); // thread → parent guild
    expect(received[0]!.threadId).toBe("C1");
    expect(received[0]!.msg.isGroup).toBe(true);
    expect(received[0]!.msg.isMention).toBe(true);
    await adapter.teardown?.();
  });

  it("deliver posts to thread channel when threadId present", async () => {
    const { impl, calls } = mockFetch([{ match: (u) => u.includes("/messages"), body: { id: "mid" } }]);
    const adapter = createDiscordAdapter({ token: "D", fetchImpl: impl });
    const id = await adapter.deliver("G1", "T9", { kind: "chat", content: "x" });
    expect(id).toBe("mid");
    const send = calls.find((c) => c.url.includes("/channels/T9/messages"));
    expect(send).toBeDefined();
    expect(send!.init?.headers).toMatchObject({ authorization: "Bot D" });
  });

  it("deliver throws on 403 (retry/failed semantics)", async () => {
    const { impl } = mockFetch([{ match: () => true, body: {}, ok: false }]);
    const adapter = createDiscordAdapter({ token: "D", fetchImpl: impl });
    await expect(adapter.deliver("C1", null, { kind: "chat", content: "x" })).rejects.toThrow(/403/);
  });
});
