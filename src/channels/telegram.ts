/**
 * channels/telegram.ts —— Telegram 通道适配器（长轮询 getUpdates）
 *
 * 职责：getUpdates 长轮询入站（offset 推进、mention entities 判定、thread id 提取）；
 *       sendMessage/sendChatAction 出站；凭据缺失 factory 返回 null。
 * 关键导出：createTelegramAdapter, registerTelegramChannel
 * 承重不变量：平台 ID 命名空间化 telegram:<id>；适配器实例盲（instance 由主机戳印）。
 * 借鉴：nanoclaw channels 分支 telegram 形态
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { log } from "../log.js";
import { registerChannelAdapter } from "./channel-registry.js";
import type { ChannelAdapter, ChannelSetup, OutboundMessage } from "./adapter.js";

export interface TelegramDeps {
  token: string;
  fetchImpl?: typeof fetch;
}

interface TgMessage {
  message_id: number;
  text?: string;
  caption?: string;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; first_name?: string; username?: string };
  message_thread_id?: number;
  entities?: Array<{ type: string; offset: number; length: number; user?: { id: number } }>;
}

export function createTelegramAdapter(deps: TelegramDeps): ChannelAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const api = (method: string) => `https://api.telegram.org/bot${deps.token}/${method}`;
  const abort = new AbortController();
  let offset = 0;
  let setupCfg: ChannelSetup | null = null;
  let polling = false;

  const isMention = (m: TgMessage, botUsername: string | null): boolean => {
    if (m.chat.type === "private") return true;
    const ents = m.entities ?? [];
    return ents.some(
      (e) =>
        (e.type === "mention" &&
          botUsername &&
          (m.text ?? "").slice(e.offset, e.offset + e.length) === `@${botUsername}`) ||
        e.type === "text_mention",
    );
  };

  async function pollLoop(): Promise<void> {
    polling = true;
    while (!abort.signal.aborted) {
      try {
        const res = await fetchImpl(`${api("getUpdates")}?offset=${offset}&timeout=25`, {
          signal: abort.signal,
        });
        if (!res.ok) {
          log.warn(`telegram getUpdates HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        const body = (await res.json()) as { ok: boolean; result: TgMessage[] };
        const results = body.result ?? [];
        // 空结果短憩，防 mock/异常场景紧循环（生产由 long-poll 25s 自然延迟）
        if (results.length === 0) await new Promise((r) => setTimeout(r, 500));
        for (const m of results) {
          offset = m.message_id + 1;
          if (!setupCfg) continue;
          const text = m.text ?? m.caption ?? "";
          if (!text) continue;
          setupCfg.onInbound(String(m.chat.id), m.message_thread_id != null ? String(m.message_thread_id) : null, {
            id: String(m.message_id),
            kind: "chat",
            content: text,
            timestamp: new Date().toISOString(),
            isMention: isMention(m, null),
            isGroup: m.chat.type !== "private",
            senderId: m.from ? `telegram:${m.from.id}` : null,
            senderName: m.from?.username ?? m.from?.first_name ?? null,
          });
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        log.warn("telegram poll error", { err });
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  return {
    name: "telegram",
    channelType: "telegram",
    supportsThreads: true,
    defaults: {
      dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "strict" },
      group: { engageMode: "mention", threads: true, unknownSenderPolicy: "request_approval" },
      mentions: "platform",
    },
    setup: (cfg) => {
      setupCfg = cfg;
      void pollLoop();
    },
    teardown: async () => {
      abort.abort();
      polling = false;
    },
    isConnected: () => polling,
    deliver: async (platformId, threadId, msg: OutboundMessage) => {
      // fix-plan 流式：operation=edit 且有编辑目标 → editMessageText 更新同一条消息
      if (msg.operation === "edit" && msg.editTarget) {
        const editBody: Record<string, unknown> = {
          chat_id: platformId,
          message_id: Number(msg.editTarget),
          text: msg.content,
        };
        const eres = await fetchImpl(api("editMessageText"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(editBody),
        });
        if (!eres.ok) throw new Error(`telegram edit HTTP ${eres.status}`);
        return msg.editTarget;
      }
      const body: Record<string, unknown> = { chat_id: platformId, text: msg.content };
      if (threadId) body.message_thread_id = Number(threadId);
      const res = await fetchImpl(api("sendMessage"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`telegram send HTTP ${res.status}`);
      const out = (await res.json()) as { result?: { message_id: number } };
      return out.result ? String(out.result.message_id) : undefined;
    },
    setTyping: async (platformId, threadId) => {
      const body: Record<string, unknown> = { chat_id: platformId, action: "typing" };
      if (threadId) body.message_thread_id = Number(threadId);
      await fetchImpl(api("sendChatAction"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
  };
}

export function registerTelegramChannel(): void {
  const { TELEGRAM_BOT_TOKEN } = readEnvFile(["TELEGRAM_BOT_TOKEN"], ENV_PATH);
  registerChannelAdapter("telegram", {
    factory: () => (TELEGRAM_BOT_TOKEN ? createTelegramAdapter({ token: TELEGRAM_BOT_TOKEN }) : null),
    defaults: {
      dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "strict" },
      group: { engageMode: "mention", threads: true, unknownSenderPolicy: "request_approval" },
      mentions: "platform",
    },
  });
}
