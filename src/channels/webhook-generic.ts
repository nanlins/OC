/**
 * channels/webhook-generic.ts —— 通用 Webhook 通道适配器（入站纯函数 + 路由表，出站 POST）
 *
 * 职责：不自起 HTTP server：parseWebhookPayload 两形态（{text,sender,channel} 通用 JSON / GitHub push commits[0].message）；
 *       handleWebhookPayload(path, body) 纯函数 + 本模块路由表，留 web/server 接线缝；deliver 出站 POST WEBHOOK_OUT_URL。
 * 关键导出：createWebhookAdapter, registerWebhookChannel, parseWebhookPayload, handleWebhookPayload,
 *           registerWebhookRoute, webhookRoutes, ingestWebhookPayload
 * 承重不变量：仅路由表内路径受理（未注册路径一律 null）；解析保持纯，入站转发由 ingest 接缝负责。
 * 借鉴：nanoclaw channels 分支 webhook 形态
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { randomUUID } from "node:crypto";
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { registerChannelAdapter } from "./channel-registry.js";
import type { ChannelAdapter, ChannelDefaults, ChannelSetup, InboundMessage, OutboundMessage } from "./adapter.js";

export interface WebhookDeps {
  outUrl: string;
  inPath?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULTS: ChannelDefaults = {
  dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "strict" },
  group: { engageMode: "mention", threads: false, unknownSenderPolicy: "request_approval" },
  mentions: "dm-only",
};

const routes = new Set<string>();

const normalizePath = (p: string): string => (p.startsWith("/") ? p : `/${p}`);

export function registerWebhookRoute(path: string): void {
  routes.add(normalizePath(path));
}

export function webhookRoutes(): string[] {
  return [...routes];
}

export function parseWebhookPayload(body: unknown): InboundMessage | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.text === "string" && obj.text.length > 0) {
    const sender = typeof obj.sender === "string" && obj.sender ? obj.sender : "unknown";
    return {
      id: randomUUID(),
      kind: "chat",
      content: obj.text,
      timestamp: new Date().toISOString(),
      isMention: true,
      isGroup: false,
      senderId: `webhook:${sender}`,
      senderName: sender,
    };
  }
  if (Array.isArray(obj.commits) && obj.commits.length > 0) {
    const first = obj.commits[0] as Record<string, unknown> | undefined;
    const message = first && typeof first.message === "string" ? first.message : "";
    if (!message) return null;
    const login =
      obj.sender && typeof obj.sender === "object"
        ? ((obj.sender as Record<string, unknown>).login as string | undefined)
        : undefined;
    return {
      id: first && typeof first.id === "string" ? first.id : randomUUID(),
      kind: "chat",
      content: message,
      timestamp: new Date().toISOString(),
      isMention: true,
      isGroup: false,
      senderId: `webhook:github:${typeof login === "string" ? login : "push"}`,
      senderName: typeof login === "string" ? login : null,
    };
  }
  return null;
}

export function handleWebhookPayload(path: string, body: unknown): InboundMessage | null {
  if (!routes.has(normalizePath(path))) return null;
  return parseWebhookPayload(body);
}

let inboundSink: ChannelSetup | null = null;

/** web/server 接线缝：路由命中并解析后转发到活动适配器的 onInbound */
export function ingestWebhookPayload(path: string, body: unknown): InboundMessage | null {
  const msg = handleWebhookPayload(path, body);
  if (!msg || !inboundSink) return msg;
  const channel =
    body && typeof body === "object" ? ((body as Record<string, unknown>).channel as string | undefined) : undefined;
  inboundSink.onInbound(typeof channel === "string" && channel ? channel : `webhook:${normalizePath(path)}`, null, msg);
  return msg;
}

export function createWebhookAdapter(deps: WebhookDeps): ChannelAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const inPath = normalizePath(deps.inPath ?? "/webhook");

  return {
    name: "webhook-generic",
    channelType: "webhook",
    supportsThreads: false,
    defaults: DEFAULTS,
    setup: (cfg) => {
      inboundSink = cfg;
      registerWebhookRoute(inPath);
    },
    teardown: async () => {
      inboundSink = null;
    },
    isConnected: () => inboundSink !== null,
    deliver: async (platformId: string, _threadId: string | null, msg: OutboundMessage) => {
      const res = await fetchImpl(deps.outUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: msg.content, channel: platformId }),
      });
      if (!res.ok) throw new Error(`webhook send HTTP ${res.status}`);
      return undefined;
    },
  };
}

export function registerWebhookChannel(): void {
  const { WEBHOOK_OUT_URL, WEBHOOK_IN_PATH } = readEnvFile(["WEBHOOK_OUT_URL", "WEBHOOK_IN_PATH"], ENV_PATH);
  registerChannelAdapter("webhook", {
    factory: () =>
      WEBHOOK_OUT_URL ? createWebhookAdapter({ outUrl: WEBHOOK_OUT_URL, inPath: WEBHOOK_IN_PATH }) : null,
    defaults: DEFAULTS,
  });
}
