/**
 * channels/feishu.ts —— 飞书通道适配器（tenant_access_token + REST 出站）
 *
 * 职责：tenant_access_token 获取（自建应用 internal 接口，缓存至到期前 60s）；
 *       im/v1/messages text 出站；parseFeishuEvent 纯函数供测试与未来 webhook 接线（web/server）；
 *       webhook 入站不在本适配器实现。凭据缺失 factory 返回 null。
 * 关键导出：createFeishuAdapter, registerFeishuChannel, parseFeishuEvent, FEISHU_DEFAULTS
 * 承重不变量：senderId 命名空间化 feishu:<open_id>；isMention 以 mentions 含本应用 app_id 判定；
 *             秘密经 readEnvFile 白名单读取，不写 process.env。
 * 借鉴：nanoclaw channels 分支 feishu 形态
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { registerChannelAdapter } from "./channel-registry.js";
import type { ChannelAdapter, ChannelDefaults, OutboundMessage } from "./adapter.js";

export interface FeishuDeps {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
}

export interface FeishuWebhookEvent {
  schema?: string;
  header?: { event_type?: string; app_id?: string; create_time?: string };
  event?: {
    sender?: { sender_id?: { open_id?: string; union_id?: string; user_id?: string } };
    message?: {
      message_id?: string;
      thread_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
      create_time?: string;
      mentions?: Array<{ key?: string; name?: string; id?: { open_id?: string; union_id?: string; app_id?: string } }>;
    };
  };
}

export interface ParsedFeishuEvent {
  platformId: string;
  threadId: string | null;
  senderId: string;
  senderName: string | null;
  messageId: string;
  content: string;
  timestamp: string;
  isGroup: boolean;
  isMention: boolean;
}

export const FEISHU_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "strict" },
  group: { engageMode: "mention", threads: false, unknownSenderPolicy: "request_approval" },
  mentions: "platform",
};

export function parseFeishuEvent(ev: FeishuWebhookEvent): ParsedFeishuEvent | null {
  if (ev.header?.event_type !== "im.message.receive_v1") return null;
  const msg = ev.event?.message;
  const openId = ev.event?.sender?.sender_id?.open_id;
  if (!msg?.chat_id || !openId) return null;
  let text = "";
  try {
    text = String((JSON.parse(msg.content ?? "{}") as { text?: string }).text ?? "");
  } catch {
    text = "";
  }
  const appId = ev.header?.app_id;
  return {
    platformId: msg.chat_id,
    threadId: msg.thread_id ?? null,
    senderId: `feishu:${openId}`,
    senderName: null,
    messageId: msg.message_id ?? "",
    content: text,
    timestamp: msg.create_time ? new Date(Number(msg.create_time)).toISOString() : new Date().toISOString(),
    isGroup: msg.chat_type === "group",
    isMention: (msg.mentions ?? []).some((m) => Boolean(appId) && m.id?.app_id === appId),
  };
}

export function createFeishuAdapter(deps: FeishuDeps): ChannelAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let cached: { token: string; expireAt: number } | null = null;

  async function tenantAccessToken(): Promise<string> {
    if (cached && Date.now() < cached.expireAt) return cached.token;
    const res = await fetchImpl("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: deps.appId, app_secret: deps.appSecret }),
    });
    if (!res.ok) throw new Error(`feishu token HTTP ${res.status}`);
    const body = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (body.code !== 0 || !body.tenant_access_token) {
      throw new Error(`feishu token failed: ${body.msg ?? body.code}`);
    }
    cached = { token: body.tenant_access_token, expireAt: Date.now() + (body.expire ?? 7200) * 1000 - 60_000 };
    return cached.token;
  }

  return {
    name: "feishu",
    channelType: "feishu",
    supportsThreads: false,
    defaults: FEISHU_DEFAULTS,
    setup: () => {}, // webhook 入站由 web/server 后续接线
    deliver: async (platformId, _threadId, msg: OutboundMessage) => {
      const token = await tenantAccessToken();
      const res = await fetchImpl("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          receive_id: platformId,
          msg_type: "text",
          content: JSON.stringify({ text: msg.content }),
        }),
      });
      if (!res.ok) throw new Error(`feishu send HTTP ${res.status}`);
      const out = (await res.json()) as { code?: number; msg?: string; data?: { message_id?: string } };
      if (out.code !== 0) throw new Error(`feishu send failed: ${out.msg ?? out.code}`);
      return out.data?.message_id;
    },
  };
}

/** envPath 默认 ENV_PATH；测试可注入临时路径验证凭据缺失分支 */
export function registerFeishuChannel(envPath: string = ENV_PATH): void {
  const { FEISHU_APP_ID, FEISHU_APP_SECRET } = readEnvFile(["FEISHU_APP_ID", "FEISHU_APP_SECRET"], envPath);
  registerChannelAdapter("feishu", {
    factory: () =>
      FEISHU_APP_ID && FEISHU_APP_SECRET
        ? createFeishuAdapter({ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET })
        : null,
    defaults: FEISHU_DEFAULTS,
  });
}
