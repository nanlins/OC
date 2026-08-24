/**
 * feishu.test.ts —— 飞书适配器集成测试（纯本地 mock，不连外网）
 *
 * 职责：deliver 先取 tenant_access_token 再发 im/v1/messages（URL/鉴权/body/返回 message_id）；
 *       token 缓存不重复请求；凭据缺失 factory 返回 null；
 *       parseFeishuEvent 三形态（群+mention/群无 mention/单聊）+ 非目标事件返回 null。
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeishuAdapter, registerFeishuChannel, parseFeishuEvent } from "../../src/channels/feishu.js";
import type { FeishuWebhookEvent } from "../../src/channels/feishu.js";
import {
  clearChannelRegistryForTest,
  getActiveAdapters,
  initChannelAdapters,
} from "../../src/channels/channel-registry.js";
import type { ChannelSetup } from "../../src/channels/adapter.js";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function feishuFetch(calls: FetchCall[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (url.includes("tenant_access_token/internal")) {
      return jsonResponse({ code: 0, msg: "ok", tenant_access_token: "t-abc", expire: 7200 });
    }
    if (url.includes("im/v1/messages")) {
      return jsonResponse({ code: 0, msg: "success", data: { message_id: "om_789" } });
    }
    return jsonResponse({ code: 99999, msg: "unknown" }, 500);
  }) as typeof fetch;
}

function tempEnvPath(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "openclaw-feishu-test-"));
  const p = join(dir, ".env");
  writeFileSync(p, content, "utf8");
  return p;
}

function makeSetup(): ChannelSetup {
  return {
    onInbound: () => {},
    onInboundEvent: () => {},
    onMetadata: () => {},
    onAction: () => {},
  };
}

type FeishuMentions = NonNullable<NonNullable<FeishuWebhookEvent["event"]>["message"]>["mentions"];

function receiveEvent(chatType: string, mentions?: FeishuMentions): FeishuWebhookEvent {
  return {
    schema: "2.0",
    header: { event_type: "im.message.receive_v1", app_id: "cli_a1", create_time: "1755000000000" },
    event: {
      sender: { sender_id: { open_id: "ou_u1" } },
      message: {
        message_id: "om_1",
        thread_id: chatType === "group" ? "omt_9" : undefined,
        chat_id: chatType === "group" ? "oc_g1" : "oc_dm1",
        chat_type: chatType,
        message_type: "text",
        create_time: "1755000000123",
        content: JSON.stringify({ text: "hello feishu" }),
        mentions,
      },
    },
  };
}

beforeEach(() => {
  clearChannelRegistryForTest();
});

afterEach(() => {
  clearChannelRegistryForTest();
});

describe("feishu adapter", () => {
  it("deliver fetches token then posts im/v1/messages and returns message_id", async () => {
    const calls: FetchCall[] = [];
    const adapter = createFeishuAdapter({ appId: "cli_a1", appSecret: "s3cret", fetchImpl: feishuFetch(calls) });
    const id = await adapter.deliver("oc_g1", null, { kind: "chat", content: "hi feishu" });
    expect(id).toBe("om_789");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ app_id: "cli_a1", app_secret: "s3cret" });
    expect(calls[1]!.url).toBe("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id");
    const headers = calls[1]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer t-abc");
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      receive_id: "oc_g1",
      msg_type: "text",
      content: JSON.stringify({ text: "hi feishu" }),
    });
  });

  it("caches tenant_access_token across delivers", async () => {
    const calls: FetchCall[] = [];
    const adapter = createFeishuAdapter({ appId: "cli_a1", appSecret: "s3cret", fetchImpl: feishuFetch(calls) });
    await adapter.deliver("oc_g1", null, { kind: "chat", content: "one" });
    await adapter.deliver("oc_g1", null, { kind: "chat", content: "two" });
    expect(calls).toHaveLength(3); // 第二次投递不再取 token
    expect(calls.filter((c) => c.url.includes("tenant_access_token"))).toHaveLength(1);
  });

  it("deliver throws when Feishu API returns code!=0", async () => {
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("tenant_access_token/internal")) {
        return jsonResponse({ code: 0, tenant_access_token: "t-abc", expire: 7200 });
      }
      return jsonResponse({ code: 230001, msg: "bot not in chat" });
    }) as typeof fetch;
    const adapter = createFeishuAdapter({ appId: "cli_a1", appSecret: "s3cret", fetchImpl });
    await expect(adapter.deliver("oc_g1", null, { kind: "chat", content: "x" })).rejects.toThrow(/bot not in chat/);
  });

  it("factory returns null when credentials missing", async () => {
    registerFeishuChannel(tempEnvPath("OTHER_KEY=1\n"));
    await initChannelAdapters(() => makeSetup());
    expect(getActiveAdapters().map((a) => a.name)).not.toContain("feishu");
  });

  it("parseFeishuEvent parses group message with mention", () => {
    const parsed = parseFeishuEvent(
      receiveEvent("group", [{ key: "@_user_1", name: "小助手", id: { open_id: "ou_bot", app_id: "cli_a1" } }]),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!).toMatchObject({
      platformId: "oc_g1",
      threadId: "omt_9",
      senderId: "feishu:ou_u1",
      messageId: "om_1",
      isGroup: true,
      isMention: true,
    });
    expect(parsed!.content).toBe("hello feishu");
  });

  it("parseFeishuEvent parses group message without mention (app_id mismatch ignored)", () => {
    const parsed = parseFeishuEvent(receiveEvent("group", [{ key: "@_user_1", id: { app_id: "cli_other" } }]));
    expect(parsed).not.toBeNull();
    expect(parsed!).toMatchObject({ platformId: "oc_g1", isGroup: true, isMention: false });
  });

  it("parseFeishuEvent parses p2p message as DM without thread", () => {
    const parsed = parseFeishuEvent(receiveEvent("p2p"));
    expect(parsed).not.toBeNull();
    expect(parsed!).toMatchObject({
      platformId: "oc_dm1",
      threadId: null,
      senderId: "feishu:ou_u1",
      isGroup: false,
      isMention: false,
    });
  });

  it("parseFeishuEvent returns null for non-target event type", () => {
    const ev = receiveEvent("group");
    ev.header = { event_type: "im.message.message_read_v1", app_id: "cli_a1" };
    expect(parseFeishuEvent(ev)).toBeNull();
  });
});
