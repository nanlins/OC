/**
 * slack.test.ts —— Slack 适配器集成测试（纯本地 mock，不连外网）
 *
 * 职责：deliver chat.postMessage 的 URL/鉴权/body/返回 ts；凭据缺失 factory 返回 null；
 *       hello 握手 + events_api ack + 入站三形态（群/单聊/mention）；断线指数退避重连。
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSlackAdapter, registerSlackChannel } from "../../src/channels/slack.js";
import {
  clearChannelRegistryForTest,
  getActiveAdapters,
  initChannelAdapters,
} from "../../src/channels/channel-registry.js";
import type { ChannelSetup, InboundMessage } from "../../src/channels/adapter.js";
import type { WebSocketLike } from "../../src/channels/discord.js";

class MockSocket implements WebSocketLike {
  sent: string[] = [];
  closed = false;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onopen: (() => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

interface Seen {
  platformId: string;
  threadId: string | null;
  message: InboundMessage;
}

function makeSetup(seen: Seen[]): ChannelSetup {
  return {
    onInbound: (platformId, threadId, message) => {
      seen.push({ platformId, threadId, message });
    },
    onInboundEvent: () => {},
    onMetadata: () => {},
    onAction: () => {},
  };
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function slackFetch(calls: FetchCall[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (url.endsWith("/apps.connections.open")) return jsonResponse({ ok: true, url: "wss://slack.invalid/socket" });
    if (url.endsWith("/chat.postMessage")) return jsonResponse({ ok: true, ts: "1723456789.000100" });
    return jsonResponse({ ok: false, error: "unknown_method" }, 500);
  }) as typeof fetch;
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function tempEnvPath(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "oc-slack-test-"));
  const p = join(dir, ".env");
  writeFileSync(p, content, "utf8");
  return p;
}

beforeEach(() => {
  clearChannelRegistryForTest();
});

afterEach(() => {
  clearChannelRegistryForTest();
});

describe("slack adapter", () => {
  it("deliver posts chat.postMessage with Bearer auth and returns ts", async () => {
    const calls: FetchCall[] = [];
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      fetchImpl: slackFetch(calls),
    });
    const id = await adapter.deliver("C123", "1723456780.000050", { kind: "chat", content: "hello slack" });
    expect(id).toBe("1723456789.000100");
    const call = calls.find((c) => c.url.endsWith("/chat.postMessage"));
    expect(call).toBeDefined();
    expect(call!.url).toBe("https://slack.com/api/chat.postMessage");
    const headers = call!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer xoxb-test");
    expect(JSON.parse(String(call!.init?.body))).toEqual({
      channel: "C123",
      thread_ts: "1723456780.000050",
      text: "hello slack",
    });
  });

  it("deliver without threadId omits thread_ts", async () => {
    const calls: FetchCall[] = [];
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      fetchImpl: slackFetch(calls),
    });
    await adapter.deliver("C123", null, { kind: "chat", content: "no thread" });
    const call = calls.find((c) => c.url.endsWith("/chat.postMessage"))!;
    expect(JSON.parse(String(call.init?.body))).toEqual({ channel: "C123", text: "no thread" });
  });

  it("deliver throws when Slack API returns ok=false", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      fetchImpl: (async () => jsonResponse({ ok: false, error: "channel_not_found" })) as typeof fetch,
    });
    await expect(adapter.deliver("C404", null, { kind: "chat", content: "x" })).rejects.toThrow(/channel_not_found/);
  });

  it("factory returns null when credentials missing", async () => {
    registerSlackChannel(tempEnvPath("OTHER_KEY=1\n"));
    await initChannelAdapters(() => makeSetup([]));
    expect(getActiveAdapters().map((a) => a.name)).not.toContain("slack");
  });

  it("handshakes hello, acks envelope and dispatches group message with mention", async () => {
    const sockets: MockSocket[] = [];
    const adapter = createSlackAdapter({
      botToken: "xoxb",
      appToken: "xapp",
      fetchImpl: slackFetch([]),
      wsFactory: (url) => {
        expect(url).toBe("wss://slack.invalid/socket");
        const s = new MockSocket();
        sockets.push(s);
        return s;
      },
    });
    const seen: Seen[] = [];
    adapter.setup(makeSetup(seen));
    await waitFor(() => sockets.length === 1);
    const sock = sockets[0]!;
    sock.onmessage!({ data: JSON.stringify({ type: "hello", connection_info: { app_id: "A1" } }) });
    expect(sock.sent).toContain(JSON.stringify({ type: "hello" }));
    sock.onmessage!({
      data: JSON.stringify({
        type: "events_api",
        envelope_id: "env-1",
        payload: {
          event: {
            type: "message",
            channel: "C123",
            channel_type: "C",
            user: "U999",
            text: "hi <@U0BOT> do it",
            ts: "1723456789.000200",
            thread_ts: "1723456780.000050",
          },
        },
      }),
    });
    expect(sock.sent).toContain(JSON.stringify({ envelope_id: "env-1" }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!).toMatchObject({ platformId: "C123", threadId: "1723456780.000050" });
    expect(seen[0]!.message).toMatchObject({
      id: "1723456789.000200",
      content: "hi <@U0BOT> do it",
      isMention: true,
      isGroup: true,
      senderId: "slack:U999",
    });
    await adapter.teardown!();
  });

  it("dispatches DM message without mention", async () => {
    const sockets: MockSocket[] = [];
    const adapter = createSlackAdapter({
      botToken: "xoxb",
      appToken: "xapp",
      fetchImpl: slackFetch([]),
      wsFactory: () => {
        const s = new MockSocket();
        sockets.push(s);
        return s;
      },
    });
    const seen: Seen[] = [];
    adapter.setup(makeSetup(seen));
    await waitFor(() => sockets.length === 1);
    sockets[0]!.onmessage!({
      data: JSON.stringify({
        type: "events_api",
        envelope_id: "env-2",
        payload: {
          event: { type: "message", channel: "D9", channel_type: "D", user: "U1", text: "plain dm", ts: "2.0" },
        },
      }),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!).toMatchObject({ platformId: "D9", threadId: null });
    expect(seen[0]!.message).toMatchObject({ content: "plain dm", isMention: false, isGroup: false });
    await adapter.teardown!();
  });

  it("dispatches app_mention event as mention", async () => {
    const sockets: MockSocket[] = [];
    const adapter = createSlackAdapter({
      botToken: "xoxb",
      appToken: "xapp",
      fetchImpl: slackFetch([]),
      wsFactory: () => {
        const s = new MockSocket();
        sockets.push(s);
        return s;
      },
    });
    const seen: Seen[] = [];
    adapter.setup(makeSetup(seen));
    await waitFor(() => sockets.length === 1);
    sockets[0]!.onmessage!({
      data: JSON.stringify({
        type: "events_api",
        envelope_id: "env-3",
        payload: {
          event: {
            type: "app_mention",
            channel: "C7",
            channel_type: "C",
            user: "U2",
            text: "<@U0BOT> help me",
            ts: "3.0",
          },
        },
      }),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.message).toMatchObject({ isMention: true, isGroup: true });
    await adapter.teardown!();
  });

  it("reconnects with exponential backoff after socket close", async () => {
    vi.useFakeTimers();
    try {
      const sockets: MockSocket[] = [];
      const adapter = createSlackAdapter({
        botToken: "xoxb",
        appToken: "xapp",
        fetchImpl: slackFetch([]),
        wsFactory: () => {
          const s = new MockSocket();
          sockets.push(s);
          return s;
        },
      });
      adapter.setup(makeSetup([]));
      await vi.advanceTimersByTimeAsync(0);
      expect(sockets).toHaveLength(1);
      sockets[0]!.onclose!();
      await vi.advanceTimersByTimeAsync(999);
      expect(sockets).toHaveLength(1); // 首次退避 1000ms 未到
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(2);
      sockets[1]!.onclose!();
      await vi.advanceTimersByTimeAsync(1999);
      expect(sockets).toHaveLength(2); // 二次退避翻倍至 2000ms
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(3);
      await adapter.teardown!();
    } finally {
      vi.useRealTimers();
    }
  });
});
