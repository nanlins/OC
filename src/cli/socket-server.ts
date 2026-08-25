/**
 * cli/socket-server.ts —— CLI socket 服务端（oc 命令入口）
 *
 * 职责：net server（unix socket chmod 0600 / win32 named pipe）；行分隔 JSON 帧；
 *       传输适配器填充 caller={actor:'host'}；dispatch → 响应帧。
 * 关键导出：startCliServer, stopCliServer, cliControlPath, handleCliLine
 * 承重不变量：socket 路径权限即身份（unix 0600）；帧不携带身份。
 * 借鉴：nanoclaw src/cli/socket-server.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 */
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
  return process.platform === "win32" ? `\\\\.\\pipe\\oc-ctl-${INSTALL_SLUG}` : join(DATA_DIR, "ncl.sock");
}

/** 单行帧处理（测试可直接调用）。
 *  P0 修复（se-inspector）：身份带外传参，帧内 caller 字段被剥离（帧不携带身份，传输适配器填充）；
 *  actor 白名单校验 fail-closed。 */
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
        chmodSync(path, 0o600); // socket 权限即身份
      } catch (err) {
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
