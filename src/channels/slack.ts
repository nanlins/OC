/**
 * channels/slack.ts —— Slack 通道适配器（Socket Mode WebSocket + REST 出站）
 *
 * 职责：apps.connections.open 取 wss URL 建连；hello 握手；events_api 入站分发并 ack envelope
 *       （message/app_mention → onInbound）；chat.postMessage 出站；指数退避重连；凭据缺失 factory 返回 null。
 * 关键导出：createSlackAdapter, registerSlackChannel, SLACK_DEFAULTS
 * 承重不变量：mention 只认 app_mention 事件或 text 含 <@Uxxxx>（路由器无文本回退）；
 *             thread 取 thread_ts；isGroup 以 channel_type==='C' 判定；秘密经 readEnvFile 白名单读取。
 * 借鉴：nanoclaw channels 分支 slack 形态
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { randomUUID } from "node:crypto";
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { log } from "../log.js";
import { registerChannelAdapter } from "./channel-registry.js";
import type { WebSocketLike } from "./discord.js";
import type { ChannelAdapter, ChannelDefaults, ChannelSetup, OutboundMessage } from "./adapter.js";

export interface SlackDeps {
  botToken: string;
  appToken: string;
  wsFactory?: (url: string) => WebSocketLike;
  fetchImpl?: typeof fetch;
}

interface SlackEvent {
  type: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

export const SLACK_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "strict" },
  group: { engageMode: "mention", threads: true, unknownSenderPolicy: "request_approval" },
  mentions: "platform",
};

const MENTION_RE = /<@U[A-Z0-9]+>/;

export function createSlackAdapter(deps: SlackDeps): ChannelAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const wsFactory = deps.wsFactory ?? ((url: string) => new WebSocket(url) as WebSocketLike);
  let ws: WebSocketLike | null = null;
  let setupCfg: ChannelSetup | null = null;
  let aborted = false;
  let reconnectDelay = 1000;

  function dispatch(event: SlackEvent): void {
    if (!setupCfg || !event.channel) return;
    if (event.type !== "message" && event.type !== "app_mention") return;
    if (event.type === "message" && (event.bot_id || event.subtype)) return; // 跳过 bot 自身与编辑类子类型
    const text = event.text ?? "";
    if (event.type === "message" && !text) return;
    setupCfg.onInbound(event.channel, event.thread_ts ?? null, {
      id: event.ts ?? randomUUID(),
      kind: "chat",
      content: text,
      timestamp: new Date().toISOString(),
      isMention: event.type === "app_mention" || MENTION_RE.test(text),
      isGroup: event.channel_type === "C",
      senderId: event.user ? `slack:${event.user}` : null,
      senderName: null,
    });
  }

  async function connect(): Promise<void> {
    if (aborted) return;
    try {
      const res = await fetchImpl("https://slack.com/api/apps.connections.open", {
        method: "POST",
        headers: { authorization: `Bearer ${deps.appToken}` },
      });
      if (!res.ok) throw new Error(`slack apps.connections.open HTTP ${res.status}`);
      const body = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!body.ok || !body.url) throw new Error(`slack apps.connections.open failed: ${body.error ?? "no url"}`);
      ws = wsFactory(body.url);
      ws.onopen = () => {
        reconnectDelay = 1000; // 连接成功重置退避
      };
      ws.onmessage = (ev) => {
        const pkt = JSON.parse(ev.data) as {
          type?: string;
          envelope_id?: string;
          payload?: { event?: SlackEvent };
        };
        if (pkt.type === "hello") {
          ws?.send(JSON.stringify({ type: "hello" }));
          return;
        }
        if (pkt.type !== "events_api") return;
        if (pkt.envelope_id) ws?.send(JSON.stringify({ envelope_id: pkt.envelope_id }));
        if (pkt.payload?.event) dispatch(pkt.payload.event);
      };
      ws.onclose = () => {
        if (aborted) return;
        // 指数退避上限 1h（与 discord 基线同语义：防高频重连招致封禁）
        setTimeout(() => void connect(), reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 3_600_000);
      };
    } catch (err) {
      if (aborted) return;
      log.warn("slack connect failed", { err });
      setTimeout(() => void connect(), reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 3_600_000);
    }
  }

  return {
    name: "slack",
    channelType: "slack",
    supportsThreads: true,
    defaults: SLACK_DEFAULTS,
    setup: (cfg) => {
      setupCfg = cfg;
      void connect();
    },
    teardown: async () => {
      aborted = true;
      ws?.close();
    },
    isConnected: () => ws !== null && !aborted,
    deliver: async (platformId, threadId, msg: OutboundMessage) => {
      const body: Record<string, unknown> = { channel: platformId, text: msg.content };
      if (threadId) body.thread_ts = threadId;
      const res = await fetchImpl("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { authorization: `Bearer ${deps.botToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`slack send HTTP ${res.status}`);
      const out = (await res.json()) as { ok: boolean; ts?: string; error?: string };
      if (!out.ok) throw new Error(`slack send failed: ${out.error ?? "unknown"}`);
      return out.ts;
    },
  };
}

/** envPath 默认 ENV_PATH；测试可注入临时路径验证凭据缺失分支 */
export function registerSlackChannel(envPath: string = ENV_PATH): void {
  const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN } = readEnvFile(["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"], envPath);
  registerChannelAdapter("slack", {
    factory: () =>
      SLACK_BOT_TOKEN && SLACK_APP_TOKEN
        ? createSlackAdapter({ botToken: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN })
        : null,
    defaults: SLACK_DEFAULTS,
  });
}
