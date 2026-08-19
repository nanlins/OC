/**
 * telegram.test.ts —— Telegram 适配器测试（fetch 注入，纯本地）
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { describe, expect, it } from "vitest";
import { createTelegramAdapter } from "../../src/channels/telegram.js";
import type { InboundMessage } from "../../src/channels/adapter.js";

function mockFetch(routes: Array<{ match: (url: string) => boolean; body: unknown; ok?: boolean }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const route = routes.find((r) => r.match(u));
    return {
      ok: route?.ok ?? true,
      status: route?.ok === false ? 500 : 200,
      json: async () => route?.body ?? {},
    } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

describe("telegram adapter", () => {
  it("deliver posts sendMessage with thread id", async () => {
    const { impl, calls } = mockFetch([
      { match: (u) => u.includes("sendMessage"), body: { result: { message_id: 77 } } },
    ]);
    const adapter = createTelegramAdapter({ token: "T", fetchImpl: impl });
    const id = await adapter.deliver("123", "9", { kind: "chat", content: "hi" });
    expect(id).toBe("77");
    const call = calls[0]!;
    expect(call.url).toContain("botT/sendMessage");
    const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>;
    expect(body.chat_id).toBe("123");
    expect(body.message_thread_id).toBe(9);
  });

  it("deliver throws on HTTP error (delivery retry semantics)", async () => {
    const { impl } = mockFetch([{ match: () => true, body: {}, ok: false }]);
    const adapter = createTelegramAdapter({ token: "T", fetchImpl: impl });
    await expect(adapter.deliver("1", null, { kind: "chat", content: "x" })).rejects.toThrow(/HTTP 500/);
  });

  it("poll loop dispatches inbound with mention and group flags", async () => {
    let calls = 0;
    const { impl } = mockFetch([
      {
        match: (u) => u.includes("getUpdates"),
        body: {
          ok: true,
          get result() {
            calls += 1;
            return calls === 1
              ? [
                  {
                    message_id: 1,
                    text: "hello @bot",
                    chat: { id: 5, type: "supergroup" },
                    from: { id: 9, username: "u" },
                    message_thread_id: 3,
                    entities: [{ type: "mention", offset: 6, length: 4 }],
                  },
                ]
              : [];
          },
        },
      },
    ]);
    const received: InboundMessage[] = [];
    const adapter = createTelegramAdapter({ token: "T", fetchImpl: impl });
    adapter.setup({
      onInbound: (_p, _t, m) => received.push(m),
      onInboundEvent: () => {},
      onMetadata: () => {},
      onAction: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    await adapter.teardown?.();
    expect(received.length).toBe(1);
    expect(received[0]!.isGroup).toBe(true);
    expect(received[0]!.senderId).toBe("telegram:9");
    expect(received[0]!.content).toBe("hello @bot");
  });

  it("setTyping sends sendChatAction", async () => {
    const { impl, calls } = mockFetch([{ match: (u) => u.includes("sendChatAction"), body: {} }]);
    const adapter = createTelegramAdapter({ token: "T", fetchImpl: impl });
    await adapter.setTyping?.("123", null);
    expect(calls[0]!.url).toContain("sendChatAction");
  });

  it("operation=edit with editTarget calls editMessageText (fix-plan streaming delivery)", async () => {
    const { impl, calls } = mockFetch([{ match: (u) => u.includes("editMessageText"), body: { result: true } }]);
    const adapter = createTelegramAdapter({ token: "T", fetchImpl: impl });
    const id = await adapter.deliver("123", null, {
      kind: "chat",
      content: "updated text",
      operation: "edit",
      editTarget: "77",
    });
    expect(id).toBe("77");
    const call = calls[0]!;
    expect(call.url).toContain("botT/editMessageText");
    const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>;
    expect(body.chat_id).toBe("123");
    expect(body.message_id).toBe(77);
    expect(body.text).toBe("updated text");
  });

  it("operation=edit without editTarget falls back to sendMessage", async () => {
    const { impl, calls } = mockFetch([
      { match: (u) => u.includes("sendMessage"), body: { result: { message_id: 88 } } },
    ]);
    const adapter = createTelegramAdapter({ token: "T", fetchImpl: impl });
    const id = await adapter.deliver("123", null, { kind: "chat", content: "x", operation: "edit" });
    expect(id).toBe("88");
    expect(calls[0]!.url).toContain("sendMessage");
  });
});
