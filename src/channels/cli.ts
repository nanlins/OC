/**
 * channels/cli.ts ?”â€?CLI ?šé??‚é??¨ï??…ç½®ï¼Œsocket ?šä¿¡ï¼? *
 * ?Œè´£ï¼šnet serverï¼ˆUnix socket / Windows named pipeï¼‰ï?å®¢æˆ·ç«¯å? JSON è¡?{text} ?–çº¯?‡æœ¬ ?? *       onInbound('local', null, msg)ï¼›deliver ??JSON è¡Œç?å·²è??¥å®¢?·ç«¯?? * ?³é”®å¯¼å‡ºï¼šCLI_DEFAULTS, cliSocketPath
 * ?¸å?æ¨¡å?ï¼šsocket è·¯å??ƒé??³èº«ä»½ï?chmod 0600 / pipe ACLï¼‰ï??•è?å¤©æ§½ä½è¯­ä¹‰ç??–ä¸ºå¤šå®¢?·ç«¯å¹¿æ’­?? * ?Ÿé‰´ï¼šnanoclaw src/channels/cli.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?5ï¼? *   2026-08-12 ä¿®å?ï¼šwin32 teardown ç­‰å?ç®¡é??Šæ”¾ï¼ˆé˜²??server ç«æ€ï?
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
  return process.platform === "win32" ? `\\\\.\\pipe\\OC-chat-${INSTALL_SLUG}` : join(DATA_DIR, "cli-chat.sock");
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
              text = line; // çº¯æ??¬å?åº?            }
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
            chmodSync(path, 0o600); // socket ?ƒé??³èº«ä»?          } catch (err) {
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
      // Windows named pipe ?Šæ”¾å¼‚æ­¥ï¼šç?å¾…è??¥è¢«?’ï??²ä?ä¸ªä½¿?¨è€…è??°æ—§ serverï¼ˆæ?è¯•ç??ä¿®å¤ï?
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
      const line = JSON.stringify({ text: msg.content, kind: msg.kind, operation: msg.operation ?? null }) + "\n";
      for (const c of clients) c.write(line);
      return undefined;
    },
  };
  return adapter;
}

registerChannelAdapter("cli", { factory: () => createCliAdapter(), defaults: CLI_DEFAULTS });
