/**
 * channels/discord.ts —— Discord 通道适配器（Gateway WebSocket + REST 出站）
 *
 * 职责：Gateway v10 IDENTIFY/心跳/MESSAGE_CREATE 分发（guild/dm、thread 判定）；
 *       REST /channels/<id>/messages 出站；指数退避重连（防 IP 封禁，基线同语义）。
 * 关键导出：createDiscordAdapter, registerDiscordChannel
 * 承重不变量：mention 以平台 mention_users 判定；thread 类型 channel（11/12）提 threadId。
 * 借鉴：nanoclaw channels 分支 discord 形态
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 *   2026-08-13 移除未使用的 log import（lint 修复）
 */
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { registerChannelAdapter } from "./channel-registry.js";
import type { ChannelAdapter, ChannelSetup, OutboundMessage } from "./adapter.js";

export interface DiscordDeps {
  token: string;
  wsFactory?: (url: string) => WebSocketLike;
  fetchImpl?: typeof fetch;
}

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onopen: (() => void) | null;
}

const THREAD_TYPES = new Set([11, 12]);

export function createDiscordAdapter(deps: DiscordDeps): ChannelAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const wsFactory = deps.wsFactory ?? ((url: string) => new WebSocket(url) as WebSocketLike);
  let ws: WebSocketLike | null = null;
  let setupCfg: ChannelSetup | null = null;
  let aborted = false;
  let reconnectDelay = 1000;
  let hbTimer: ReturnType<typeof setInterval> | null = null;

  const rest = (path: string, init?: RequestInit) =>
    fetchImpl(`https://discord.com/api/v10${path}`, {
      ...init,
      headers: { authorization: `Bot ${deps.token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    });

  function connect(): void {
    if (aborted) return;
    ws = wsFactory("wss://gateway.discord.gg/?v=10&encoding=json");
    ws.onopen = () => {
      reconnectDelay = 1000; // 连接成功重置退避
      ws?.send(
        JSON.stringify({
          op: 2,
          d: {
            token: `Bot ${deps.token}`,
            intents: (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15), // GUILDS|GUILD_MESSAGES|DIRECT_MESSAGES|MESSAGE_CONTENT
            properties: { os: "linux", browser: "oc", device: "oc" },
          },
        }),
      );
    };
    ws.onmessage = (ev) => {
      const pkt = JSON.parse(ev.data) as { op: number; d?: Record<string, unknown>; t?: string };
      if (pkt.op === 10) {
        const interval = (pkt.d as { heartbeat_interval: number }).heartbeat_interval;
        hbTimer = setInterval(() => ws?.send(JSON.stringify({ op: 1, d: null })), interval);
      } else if (pkt.op === 0 && pkt.t === "MESSAGE_CREATE") {
        const d = pkt.d as {
          id: string;
          content?: string;
          channel_id: string;
          guild_id?: string;
          type: number;
          author?: { id: string; username?: string; bot?: boolean };
          mentions?: Array<{ id: string }>;
        };
        if (!setupCfg || d.author?.bot) return;
        const isThread = THREAD_TYPES.has(d.type);
        setupCfg.onInbound(isThread ? (d.guild_id ?? d.channel_id) : d.channel_id, isThread ? d.channel_id : null, {
          id: d.id,
          kind: "chat",
          content: d.content ?? "",
          timestamp: new Date().toISOString(),
          isMention: !d.guild_id ? true : (d.mentions ?? []).some((m) => m.id === botUserId),
          isGroup: Boolean(d.guild_id),
          senderId: d.author ? `discord:${d.author.id}` : null,
          senderName: d.author?.username ?? null,
        });
      }
    };
    ws.onclose = () => {
      if (hbTimer) clearInterval(hbTimer);
      if (aborted) return;
      // 指数退避上限 1h（基线同语义：防高频重连招致封禁）
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 3_600_000);
    };
  }

  let botUserId = "";
  void rest("/users/@me")
    .then(async (r) => {
      if (r.ok) botUserId = ((await r.json()) as { id: string }).id;
    })
    .catch(() => {});

  return {
    name: "discord",
    channelType: "discord",
    supportsThreads: true,
    defaults: {
      dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "strict" },
      group: { engageMode: "mention-sticky", threads: true, unknownSenderPolicy: "request_approval" },
      mentions: "platform",
    },
    setup: (cfg) => {
      setupCfg = cfg;
      connect();
    },
    teardown: async () => {
      aborted = true;
      if (hbTimer) clearInterval(hbTimer);
      ws?.close();
    },
    isConnected: () => ws !== null && !aborted,
    deliver: async (platformId, threadId, msg: OutboundMessage) => {
      const channelId = threadId ?? platformId;
      const res = await rest(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: msg.content }),
      });
      if (!res.ok) throw new Error(`discord send HTTP ${res.status}`);
      const out = (await res.json()) as { id?: string };
      return out.id;
    },
    setTyping: async (platformId, threadId) => {
      const channelId = threadId ?? platformId;
      await rest(`/channels/${channelId}/typing`, { method: "POST" }).catch(() => {});
    },
  };
}

export function registerDiscordChannel(): void {
  const { DISCORD_BOT_TOKEN } = readEnvFile(["DISCORD_BOT_TOKEN"], ENV_PATH);
  registerChannelAdapter("discord", {
    factory: () => (DISCORD_BOT_TOKEN ? createDiscordAdapter({ token: DISCORD_BOT_TOKEN }) : null),
    defaults: {
      dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "strict" },
      group: { engageMode: "mention-sticky", threads: true, unknownSenderPolicy: "request_approval" },
      mentions: "platform",
    },
  });
}
