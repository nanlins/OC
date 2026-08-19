/**
 * channels/dingtalk.ts —— 钉钉通道适配器（自定义机器人 webhook 出站）
 *
 * 职责：webhook POST 出站（node:crypto HmacSHA256 计算 timestamp+"\n"+secret 签名，base64 URL 编码拼 URL）；
 *       parseDingtalkEvent 纯函数供测试与未来 /robot/callback 接线（web/server）；
 *       入站路由不在本适配器实现。凭据缺失 factory 返回 null。
 * 关键导出：createDingtalkAdapter, registerDingtalkChannel, parseDingtalkEvent, dingtalkSignedUrl, DINGTALK_DEFAULTS
 * 承重不变量：senderId 命名空间化 dingtalk:<senderStaffId>；单聊（conversationType==='1'）恒 isMention；
 *             秘密经 readEnvFile 白名单读取，不写 process.env。
 * 借鉴：nanoclaw channels 分支 dingtalk 形态
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { createHmac } from "node:crypto";
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { registerChannelAdapter } from "./channel-registry.js";
import type { ChannelAdapter, ChannelDefaults, OutboundMessage } from "./adapter.js";

export interface DingtalkDeps {
  webhookUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

export interface DingtalkCallbackEvent {
  conversationId?: string;
  conversationType?: string;
  conversationTitle?: string;
  senderStaffId?: string;
  senderNick?: string;
  msgId?: string;
  msgtype?: string;
  text?: { content?: string };
  isInAtList?: boolean;
  createAt?: number;
}

export interface ParsedDingtalkEvent {
  platformId: string;
  threadId: null;
  senderId: string;
  senderName: string | null;
  messageId: string;
  content: string;
  isGroup: boolean;
  isMention: boolean;
}

export const DINGTALK_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "strict" },
  group: { engageMode: "mention", threads: false, unknownSenderPolicy: "request_approval" },
  mentions: "platform",
};

export function dingtalkSignedUrl(webhookUrl: string, secret: string, timestamp: number): string {
  const sign = createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  const sep = webhookUrl.includes("?") ? "&" : "?";
  return `${webhookUrl}${sep}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
}

/** botName 提供时按 text 含 @<botName> 判定 mention；缺省用平台 isInAtList 信号 */
export function parseDingtalkEvent(ev: DingtalkCallbackEvent, botName?: string): ParsedDingtalkEvent | null {
  if (!ev.conversationId || !ev.senderStaffId) return null;
  const text = ev.text?.content?.trim() ?? "";
  const mentioned = botName ? text.includes(`@${botName}`) : (ev.isInAtList ?? false);
  return {
    platformId: ev.conversationId,
    threadId: null,
    senderId: `dingtalk:${ev.senderStaffId}`,
    senderName: ev.senderNick ?? null,
    messageId: ev.msgId ?? "",
    content: text,
    isGroup: ev.conversationType === "2",
    isMention: ev.conversationType === "1" || mentioned,
  };
}

export function createDingtalkAdapter(deps: DingtalkDeps): ChannelAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    name: "dingtalk",
    channelType: "dingtalk",
    supportsThreads: false,
    defaults: DINGTALK_DEFAULTS,
    setup: () => {}, // /robot/callback 入站由 web/server 后续接线
    deliver: async (_platformId, _threadId, msg: OutboundMessage) => {
      const res = await fetchImpl(dingtalkSignedUrl(deps.webhookUrl, deps.secret, Date.now()), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msgtype: "text", text: { content: msg.content } }),
      });
      if (!res.ok) throw new Error(`dingtalk send HTTP ${res.status}`);
      const out = (await res.json()) as { errcode?: number; errmsg?: string };
      if (out.errcode !== 0) throw new Error(`dingtalk send failed: ${out.errmsg ?? out.errcode}`);
      return undefined;
    },
  };
}

/** envPath 默认 ENV_PATH；测试可注入临时路径验证凭据缺失分支 */
export function registerDingtalkChannel(envPath: string = ENV_PATH): void {
  const { DINGTALK_WEBHOOK_URL, DINGTALK_SECRET } = readEnvFile(["DINGTALK_WEBHOOK_URL", "DINGTALK_SECRET"], envPath);
  registerChannelAdapter("dingtalk", {
    factory: () =>
      DINGTALK_WEBHOOK_URL && DINGTALK_SECRET
        ? createDingtalkAdapter({ webhookUrl: DINGTALK_WEBHOOK_URL, secret: DINGTALK_SECRET })
        : null,
    defaults: DINGTALK_DEFAULTS,
  });
}
