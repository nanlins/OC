/**
 * wecom.test.ts —— 企业微信通道适配器集成测试（纯本地 fetch mock，不连外网）
 *
 * 职责：deliver message/send 断言（URL/body/@all）；gettoken 缓存与 42001 刷新重试；
 *       parseWecomEvent 两形态（单聊/群聊）与非 text 拒绝；凭据缺失 factory 返回 null。
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createWecomAdapter, parseWecomEvent, registerWecomChannel } from "../../src/channels/wecom.js";
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

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const noopSetup = (): ChannelSetup => ({
  onInbound: () => {},
  onInboundEvent: () => {},
  onMetadata: () => {},
  onAction: () => {},
});

beforeEach(() => clearChannelRegistryForTest());
afterEach(() => clearChannelRegistryForTest());

describe("wecom adapter", () => {
  it("deliver posts message/send with access token and text body (touser/@all)", async () => {
    const calls: FetchCall[] = [];
    const impl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/gettoken")) return json({ errcode: 0, access_token: "tok-1", expires_in: 7200 });
      return json({ errcode: 0, errmsg: "ok", msgid: "msg-1" });
    };
    const adapter = createWecomAdapter({ corpId: "corp1", secret: "sec", agentId: "1000002", fetchImpl: impl });
    const id = await adapter.deliver("ZhangSan", null, { kind: "chat", content: "hello" });
    expect(id).toBe("msg-1");
    const send = calls.find((c) => c.url.includes("/message/send"));
    expect(send).toBeDefined();
    expect(send!.url).toContain("access_token=tok-1");
    expect(JSON.parse(String(send!.init?.body))).toMatchObject({
      touser: "ZhangSan",
      msgtype: "text",
      agentid: 1000002,
      text: { content: "hello" },
    });
    await adapter.deliver("@all", null, { kind: "chat", content: "notice" });
    const broadcast = calls.filter((c) => c.url.includes("/message/send")).at(-1);
    expect(broadcast).toBeDefined();
    expect(JSON.parse(String(broadcast!.init?.body)).touser).toBe("@all");
  });

  it("caches gettoken across delivers until expiry", async () => {
    const calls: FetchCall[] = [];
    const impl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/gettoken")) return json({ errcode: 0, access_token: "tok-1", expires_in: 7200 });
      return json({ errcode: 0, errmsg: "ok" });
    };
    const adapter = createWecomAdapter({ corpId: "c", secret: "s", agentId: "1", fetchImpl: impl });
    await adapter.deliver("u1", null, { kind: "chat", content: "a" });
    await adapter.deliver("u2", null, { kind: "chat", content: "b" });
    expect(calls.filter((c) => c.url.includes("/gettoken"))).toHaveLength(1);
  });

  it("refreshes token once when send reports 42001", async () => {
    let tokenCount = 0;
    let sendCount = 0;
    const impl: typeof fetch = async (url) => {
      if (String(url).includes("/gettoken")) {
        tokenCount += 1;
        return json({ errcode: 0, access_token: `tok-${tokenCount}`, expires_in: 7200 });
      }
      sendCount += 1;
      if (sendCount === 1) return json({ errcode: 42001, errmsg: "expired" });
      return json({ errcode: 0, errmsg: "ok", msgid: "msg-9" });
    };
    const adapter = createWecomAdapter({ corpId: "c", secret: "s", agentId: "1", fetchImpl: impl });
    const id = await adapter.deliver("u1", null, { kind: "chat", content: "x" });
    expect(id).toBe("msg-9");
    expect(tokenCount).toBe(2);
    expect(sendCount).toBe(2);
  });

  it("parseWecomEvent maps single-chat text to mention inbound", () => {
    const xml =
      "<xml><ToUserName><![CDATA[corp]]></ToUserName><FromUserName><![CDATA[ZhangSan]]></FromUserName>" +
      "<MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello bot]]></Content></xml>";
    expect(parseWecomEvent(xml)).toMatchObject({
      platformId: "ZhangSan",
      senderId: "wecom:ZhangSan",
      isMention: true,
      isGroup: false,
      toUserName: "corp",
      content: "hello bot",
    });
  });

  it("parseWecomEvent maps group chat via ChatId and rejects non-text", () => {
    const xml =
      "<xml><ToUserName>corp</ToUserName><FromUserName>LiSi</FromUserName><ChatId><![CDATA[wrk_group1]]></ChatId>" +
      "<MsgType>text</MsgType><Content>hi all</Content></xml>";
    expect(parseWecomEvent(xml)).toMatchObject({
      platformId: "wrk_group1",
      senderId: "wecom:LiSi",
      isMention: false,
      isGroup: true,
      content: "hi all",
    });
    expect(parseWecomEvent(xml.replace("<MsgType>text</MsgType>", "<MsgType>image</MsgType>"))).toBeNull();
    expect(parseWecomEvent("<xml></xml>")).toBeNull();
  });

  it("factory returns null when credentials missing", async () => {
    registerWecomChannel();
    await initChannelAdapters(() => noopSetup());
    expect(getActiveAdapters().some((a) => a.channelType === "wecom")).toBe(false);
  });
});
