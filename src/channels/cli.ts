/**
 * channels/cli.ts —— CLI 通道适配器（内置，socket 通信）
 *
 * 职责：net server（Unix socket / Windows named pipe）；客户端发 JSON 行 {text} 或纯文本 →
 *       onInbound('local', null, msg)；deliver 写 JSON 行给已连接客户端。
 * 关键导出：CLI_DEFAULTS, cliSocketPath
 * 核心模式：socket 路径权限即身份（chmod 0600 / pipe ACL）；单聊天槽位语义简化为多客户端广播。
 * 借鉴：nanoclaw src/channels/cli.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 5）
 *   2026-08-12 修复：win32 teardown 等待管道释放（防旧 server 竞态）
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, INSTALL_SLUG } from "../config.js";
import { log } from "../log.js";
import { registerChannelAdapter } from "./channel-registry.js";
import type { ChannelAdapter, ChannelDefaults, ChannelSetup, OutboundMessage } from "./adapter.js";

export function cliSocketPath(): string {
  return process.platform === "win32" ? `\\\\.\\pipe\\oc-chat-${INSTALL_SLUG}` : join(DATA_DIR, "cli-chat.sock");
}

export const CLI_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "public" },
  group: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "public" },
  mentions: "never",
};

function createCliAdapter(): ChannelAdapter {
  let server: Server | null = null;
  const clients = new Set<Socket>();

  const adapter: ChannelAdapter = {
    name: "cli",
    channelType: "cli",
    supportsThreads: false,
    defaults: CLI_DEFAULTS,

    setup: (config: ChannelSetup) => {
      const path = cliSocketPath();
      if (process.platform !== "win32" && existsSync(path)) rmSync(path, { force: true });
      server = createServer((socket) => {
        clients.add(socket);
        socket.on("close", () => clients.delete(socket));
        socket.on("error", () => clients.delete(socket));
        let buf = "";
        socket.on("data", (chunk) => {
          buf += chunk.toString();
          let idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            let text = line;
            try {
              text = String((JSON.parse(line) as { text?: string }).text ?? line);
            } catch {
              text = line; // 纯文本兜底
            }
            config.onInbound("local", null, {
              id: randomUUID(),
              kind: "chat",
              content: text,
              timestamp: new Date().toISOString(),
              isMention: true,
              isGroup: false,
              senderId: "cli:local",
              senderName: "local",
            });
          }
        });
      });
      server.listen(path, () => {
        if (process.platform !== "win32") {
          try {
            chmodSync(path, 0o600); // socket 权限即身份
          } catch (err) {
            log.warn("cli socket chmod failed", { err });
          }
        }
        log.info(`cli channel listening: ${path}`);
      });
      server.on("error", (err) => log.error("cli socket error", { err }));
    },

    teardown: async () => {
      for (const c of clients) c.destroy();
      clients.clear();
      await new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
      });
      // Windows named pipe 释放异步：等待连接被拒，防下个使用者连到旧 server（测试竞态修复）
      if (process.platform === "win32") {
        const deadline = Date.now() + 1000;
        while (Date.now() < deadline) {
          const ok = await new Promise<boolean>((resolve) => {
            const s = connect(cliSocketPath(), () => {
              s.destroy();
              resolve(true);
            });
            s.on("error", () => resolve(false));
          });
          if (!ok) break;
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        rmSync(cliSocketPath(), { force: true });
      }
    },

    isConnected: () => server !== null,

    deliver: async (_platformId, _threadId, msg: OutboundMessage) => {
      // 阶段 12：多帧协议（meta 可选 → 消息 → end），行分隔向后兼容（老客户端逐行 JSON.parse 只读 text）
      // inReplyTo：流式消息链 id（poll-loop 首条消息 id），CLI 客户端据此合并同一回复的 edit 增量
      const lines: string[] = [];
      if (msg.meta) {
        lines.push(
          JSON.stringify({
            kind: "meta",
            agent: msg.meta.agent ?? null,
            model: msg.meta.model ?? null,
            provider: msg.meta.provider ?? null,
            inReplyTo: msg.inReplyTo ?? null,
          }),
        );
      }
      lines.push(
        JSON.stringify({
          kind: msg.kind ?? "chat",
          text: msg.content,
          operation: msg.operation ?? null,
          type: msg.type ?? null,
          inReplyTo: msg.inReplyTo ?? null,
        }),
      );
      lines.push(JSON.stringify({ kind: "end", inReplyTo: msg.inReplyTo ?? null }));
      const payload = lines.join("\n") + "\n";
      for (const c of clients) c.write(payload);
      return undefined;
    },

    /** 阶段 12：容器工具状态广播（delivery 轮询 container_state 变化时调用） */
    notifyTool: (tool: string, status: "running" | "done" | "error", elapsedMs?: number) => {
      const line = JSON.stringify({ kind: "tool", tool, status, elapsedMs: elapsedMs ?? null }) + "\n";
      for (const c of clients) c.write(line);
    },
  };
  return adapter;
}

registerChannelAdapter("cli", { factory: () => createCliAdapter(), defaults: CLI_DEFAULTS });

/*
 * 修改记录：
 *   2026-08-25 阶段 12：CLI 聊天界面（meta/tool/end 帧协议 + TUI 渲染）
 */

