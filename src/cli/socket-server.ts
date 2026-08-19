/**
 * cli/socket-server.ts ?”â€?CLI socket ?åŠ¡ç«¯ï?oc ?½ä»¤?¥å£ï¼? *
 * ?Œè´£ï¼šnet serverï¼ˆunix socket chmod 0600 / win32 named pipeï¼‰ï?è¡Œå???JSON å¸§ï?
 *       ä¼ è??‚é??¨å¡«??caller={actor:'host'}ï¼›dispatch ???å?å¸§ã€? * ?³é”®å¯¼å‡ºï¼šstartCliServer, stopCliServer, cliControlPath, handleCliLine
 * ?¿é?ä¸å??ï?socket è·¯å??ƒé??³èº«ä»½ï?unix 0600ï¼‰ï?å¸§ä??ºå¸¦èº«ä»½?? * ?Ÿé‰´ï¼šnanoclaw src/cli/socket-server.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?7ï¼? */
import { createServer, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, INSTALL_SLUG } from "../config.js";
import { onHostStart, onHostShutdown } from "../host-lifecycle.js";
import { dispatch } from "./dispatch.js";
import { registerAllResources } from "./resources.js";
import { log } from "../log.js";
import type { CallerContext, ResponseFrame } from "./frame.js";

let server: Server | null = null;
let registered = false;

export function cliControlPath(): string {
  return process.platform === "win32" ? `\\\\.\\pipe\\OC-ctl-${INSTALL_SLUG}` : join(DATA_DIR, "ncl.sock");
}

/** ?•è?å¸§å??†ï?æµ‹è??¯ç›´?¥è??¨ï??? *  P0 ä¿®å?ï¼ˆse-inspectorï¼‰ï?èº«ä»½å¸¦å?ä¼ å?ï¼Œå¸§??caller å­—æ®µè¢«å‰¥ç¦»ï?å¸§ä??ºå¸¦èº«ä»½ï¼Œä?è¾“é€‚é??¨å¡«?…ï?ï¼? *  actor ?½å??•æ ¡éª?fail-closed??*/
export async function handleCliLine(line: string, caller: CallerContext = { actor: "host" }): Promise<ResponseFrame> {
  if (!registered) {
    registerAllResources();
    registered = true;
  }
  let cmd: string;
  let requestId: string | undefined;
  try {
    const parsed = JSON.parse(line) as { cmd?: string; requestId?: string };
    cmd = typeof parsed.cmd === "string" ? parsed.cmd : line;
    requestId = parsed.requestId;
  } catch {
    cmd = line;
  }
  if (caller.actor !== "host" && caller.actor !== "agent") {
    return { requestId, ok: false, code: "forbidden", error: "invalid caller actor" };
  }
  return dispatch({ cmd, requestId }, caller);
}

export function startCliServer(): void {
  if (server) return;
  if (!registered) {
    registerAllResources();
    registered = true;
  }
  const path = cliControlPath();
  if (process.platform !== "win32" && existsSync(path)) rmSync(path, { force: true });
  server = createServer((socket: Socket) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        void handleCliLine(line).then((res) => {
          socket.write(JSON.stringify(res) + "\n");
        });
      }
    });
    socket.on("error", () => {});
  });
  server.listen(path, () => {
    if (process.platform !== "win32") {
      try {
        chmodSync(path, 0o600); // socket ?ƒé??³èº«ä»?      } catch (err) {
        log.warn("cli control socket chmod failed", { err });
      }
    }
    log.info(`cli control listening: ${path}`);
  });
  server.on("error", (err) => log.error("cli control socket error", { err }));
}

export function stopCliServer(): void {
  server?.close();
  server = null;
  if (process.platform !== "win32") rmSync(cliControlPath(), { force: true });
}

onHostStart("cli-server", () => startCliServer());
onHostShutdown("cli-server", () => stopCliServer());
