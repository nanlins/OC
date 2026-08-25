/**
 * dingtalk.test.ts —— 钉钉适配器集成测试（纯本地 mock，不连外网）
 *
 * 职责：deliver webhook POST 签名 URL（timestamp+sign，HmacSHA256 复算校验）与 body；errcode 非 0 抛错；
 *       凭据缺失 factory 返回 null；parseDingtalkEvent 三形态（群+mention/群无 mention/单聊）+ 畸形返回 null。
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDingtalkAdapter,
  registerDingtalkChannel,
  parseDingtalkEvent,
  dingtalkSignedUrl,
} from "../../src/channels/dingtalk.js";
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

function tempEnvPath(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "oc-dingtalk-test-"));
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

const WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=tok123";
const SECRET = "SEC123";

beforeEach(() => {
  clearChannelRegistryForTest();
});

afterEach(() => {
  clearChannelRegistryForTest();
});

describe("dingtalk adapter", () => {
  it("deliver posts webhook with valid timestamp+sign and text body", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      return jsonResponse({ errcode: 0, errmsg: "ok" });
    }) as typeof fetch;
    const adapter = createDingtalkAdapter({ webhookUrl: WEBHOOK, secret: SECRET, fetchImpl });
    const id = await adapter.deliver("cidXXX", null, { kind: "chat", content: "hi dingtalk" });
    expect(id).toBeUndefined(); // webhook 响应无平台消息 id
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://oapi.dingtalk.com/robot/send");
    expect(url.searchParams.get("access_token")).toBe("tok123");
    const ts = url.searchParams.get("timestamp");
    const sign = url.searchParams.get("sign");
    expect(ts).toBeTruthy();
    expect(sign).toBeTruthy();
    expect(Number(ts)).toBeGreaterThan(0);
    const expected = createHmac("sha256", SECRET).update(`${ts}\n${SECRET}`).digest("base64");
    expect(sign).toBe(expected); // URL 解码后与 HmacSHA256 base64 一致
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      msgtype: "text",
      text: { content: "hi dingtalk" },
    });
  });

  it("signed url uses ? separator when webhook has no query", () => {
    const signed = dingtalkSignedUrl("https://example.com/robot/send", SECRET, 1723456789000);
    expect(signed).toContain("https://example.com/robot/send?timestamp=1723456789000&sign=");
  });

  it("deliver throws when webhook returns errcode!=0", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ errcode: 310000, errmsg: "keywords not in content" })) as typeof fetch;
    const adapter = createDingtalkAdapter({ webhookUrl: WEBHOOK, secret: SECRET, fetchImpl });
    await expect(adapter.deliver("cidXXX", null, { kind: "chat", content: "x" })).rejects.toThrow(
      /keywords not in content/,
    );
  });

  it("factory returns null when credentials missing", async () => {
    registerDingtalkChannel(tempEnvPath("OTHER_KEY=1\n"));
    await initChannelAdapters(() => makeSetup());
    expect(getActiveAdapters().map((a) => a.name)).not.toContain("dingtalk");
  });

  it("parseDingtalkEvent parses group message with mention", () => {
    const parsed = parseDingtalkEvent(
      {
        conversationId: "cidG",
        conversationType: "2",
        conversationTitle: "测试群",
        senderStaffId: "staff1",
        senderNick: "张三",
        msgId: "msg1",
        msgtype: "text",
        text: { content: "@机器人 查一下天气" },
        isInAtList: true,
      },
      "机器人",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!).toMatchObject({
      platformId: "cidG",
      threadId: null,
      senderId: "dingtalk:staff1",
      senderName: "张三",
      messageId: "msg1",
      isGroup: true,
      isMention: true,
    });
  });

  it("parseDingtalkEvent parses group message without mention", () => {
    const parsed = parseDingtalkEvent(
      {
        conversationId: "cidG",
        conversationType: "2",
        senderStaffId: "staff2",
        msgId: "msg2",
        text: { content: "闲聊一句" },
      },
      "机器人",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!).toMatchObject({ platformId: "cidG", isGroup: true, isMention: false });
  });

  it("parseDingtalkEvent parses single chat as DM with implicit mention", () => {
    const parsed = parseDingtalkEvent({
      conversationId: "cidD",
      conversationType: "1",
      senderStaffId: "staff3",
      msgId: "msg3",
      text: { content: "你好" },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!).toMatchObject({
      platformId: "cidD",
      senderId: "dingtalk:staff3",
      isGroup: false,
      isMention: true,
    });
  });

  it("parseDingtalkEvent returns null for malformed callback", () => {
    expect(parseDingtalkEvent({})).toBeNull();
    expect(parseDingtalkEvent({ conversationId: "cidX" })).toBeNull();
  });
});
