/**
 * channels/wecom.ts —— 企业微信通道适配器（回调 XML 解析 + message/send 出站）
 *
 * 职责：gettoken 凭据缓存（expires_in，40014/42001 刷新重试一次）；message/send 出站（touser/@all，msgtype text）；
 *       parseWecomEvent 纯函数：回调 XML 极简正则解析 → platformId/senderId/isMention（供后续 web 回调接线）。
 * 关键导出：createWecomAdapter, registerWecomChannel, parseWecomEvent
 * 承重不变量：sender 命名空间化 wecom:<FromUserName>；群聊取 ChatId 为 platformId；access_token 过期前不重复获取。
 * 借鉴：nanoclaw channels 分支 wecom 形态
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { registerChannelAdapter } from "./channel-registry.js";
import type { ChannelAdapter, ChannelDefaults, ChannelSetup, OutboundMessage } from "./adapter.js";

export interface WecomDeps {
  corpId: string;
  secret: string;
  agentId: string;
  fetchImpl?: typeof fetch;
}

export interface WecomEvent {
  platformId: string;
  senderId: string;
  isMention: boolean;
  isGroup: boolean;
  toUserName: string;
  content: string;
}

const API = "https://qyapi.weixin.qq.com/cgi-bin";
const TOKEN_ERRCODES = new Set([40014, 42001]);

const DEFAULTS: ChannelDefaults = {
  dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "strict" },
  group: { engageMode: "mention", threads: false, unknownSenderPolicy: "request_approval" },
  mentions: "platform",
};

const xmlField = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  return m ? (m[1] ?? "").trim() || null : null;
};

export function parseWecomEvent(xml: string): WecomEvent | null {
  const msgType = xmlField(xml, "MsgType");
  const from = xmlField(xml, "FromUserName");
  const content = xmlField(xml, "Content");
  if (msgType !== "text" || !from || !content) return null;
  const chatId = xmlField(xml, "ChatId");
  return {
    platformId: chatId ?? from,
    senderId: `wecom:${from}`,
    isMention: chatId === null,
    isGroup: chatId !== null,
    toUserName: xmlField(xml, "ToUserName") ?? "",
    content,
  };
}

export function createWecomAdapter(deps: WecomDeps): ChannelAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let setupCfg: ChannelSetup | null = null;
  let cached: { token: string; expiresAt: number } | null = null;

  async function getAccessToken(force = false): Promise<string> {
    if (!force && cached && Date.now() < cached.expiresAt) return cached.token;
    const url = `${API}/gettoken?corpid=${encodeURIComponent(deps.corpId)}&corpsecret=${encodeURIComponent(deps.secret)}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`wecom gettoken HTTP ${res.status}`);
    const body = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
    };
    if (body.errcode !== 0 || !body.access_token) {
      throw new Error(`wecom gettoken failed: ${body.errcode} ${body.errmsg ?? ""}`);
    }
    cached = { token: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 7200) - 60) * 1000 };
    return cached.token;
  }

  async function sendOnce(
    platformId: string,
    msg: OutboundMessage,
    token: string,
  ): Promise<{ errcode?: number; errmsg?: string; msgid?: string }> {
    const res = await fetchImpl(`${API}/message/send?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        touser: platformId,
        msgtype: "text",
        agentid: Number(deps.agentId),
        text: { content: msg.content },
      }),
    });
    if (!res.ok) throw new Error(`wecom send HTTP ${res.status}`);
    return (await res.json()) as { errcode?: number; errmsg?: string; msgid?: string };
  }

  return {
    name: "wecom",
    channelType: "wecom",
    supportsThreads: false,
    defaults: DEFAULTS,
    setup: (cfg) => {
      setupCfg = cfg;
    },
    isConnected: () => setupCfg !== null,
    deliver: async (platformId, _threadId, msg) => {
      let out = await sendOnce(platformId, msg, await getAccessToken());
      if (out.errcode !== 0 && TOKEN_ERRCODES.has(out.errcode ?? 0)) {
        out = await sendOnce(platformId, msg, await getAccessToken(true));
      }
      if (out.errcode !== 0) throw new Error(`wecom send failed: ${out.errcode} ${out.errmsg ?? ""}`);
      return out.msgid ? String(out.msgid) : undefined;
    },
  };
}

export function registerWecomChannel(): void {
  const { WECOM_CORP_ID, WECOM_SECRET, WECOM_AGENT_ID } = readEnvFile(
    ["WECOM_CORP_ID", "WECOM_SECRET", "WECOM_AGENT_ID"],
    ENV_PATH,
  );
  registerChannelAdapter("wecom", {
    factory: () =>
      WECOM_CORP_ID && WECOM_SECRET && WECOM_AGENT_ID
        ? createWecomAdapter({ corpId: WECOM_CORP_ID, secret: WECOM_SECRET, agentId: WECOM_AGENT_ID })
        : null,
    defaults: DEFAULTS,
  });
}
