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
 *   2026-10-06 stopCliServer 改 async 并等待 win32 命名管道真正释放（原同步返回导致快速
 *              重启 EADDRINUSE，且失败只被 log，表现为"oc 连不上宿主"）；绑定失败改 log.error
 *              并给出可行动提示
 */
import { createServer, connect, type Server, type Socket } from "node:net";
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
  server.on("error", (err) => {
    // 绑定失败必须吼出来：只记 debug 会让 `oc` 静默连不上宿主，看起来像"主机没起"
    log.error(
      `cli control socket failed to bind: ${path} (${(err as NodeJS.ErrnoException).code ?? "?"}). ` +
        `If EADDRINUSE on Windows, a previous host process has not released the named pipe yet.`,
      { err },
    );
  });
}

/**
 * 停止控制 socket，并等待命名管道真正释放。
 *
 * 承重（T2 期间实测）：Windows 上 `server.close()` 返回时命名管道**尚未**释放，
 * 紧随其后的 `listen()` 会 EADDRINUSE。原实现是同步 fire-and-forget，于是"快速重启宿主"
 * 或"下一个测试文件重新起服务"都会绑定失败——而失败只被 log，`oc` 命令表现为
 * "cannot reach the OC host"，与宿主真的没起无法区分。
 * `channels/cli.ts` 的 teardown 早就为聊天 socket 做了同样的等待，控制 socket 此前漏了。
 *
 * 改为 async 是安全的：host-lifecycle 的 Hook 类型是 `() => void | Promise<void>`，
 * stopHostModules 会 await。
 */
export async function stopCliServer(): Promise<void> {
  const s = server;
  server = null;
  if (!s) return;
  // closeAllConnections 是 Node 18.2+ 的 API，@types/node 的 net.Server 未声明；
  // 可选调用即可，缺失时 close() 回调仍会完成（只是要等空闲连接自然超时）。
  const withCloseAll = s as typeof s & { closeAllConnections?: () => void };
  try {
    withCloseAll.closeAllConnections?.();
  } catch {
    /* 忽略：不影响 close */
  }
  await new Promise<void>((resolve) => s.close(() => resolve()));
  if (process.platform !== "win32") {
    rmSync(cliControlPath(), { force: true });
    return;
  }
  // 轮询直到连接被拒（= 管道已释放），上限 1.5s，绝不无限等待
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const stillBound = await new Promise<boolean>((resolve) => {
      const probe = connect(cliControlPath(), () => {
        probe.destroy();
        resolve(true);
      });
      probe.on("error", () => {
        probe.destroy();
        resolve(false);
      });
    });
    if (!stillBound) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  log.warn("cli control named pipe still bound after 1.5s; a fast restart may hit EADDRINUSE");
}

onHostStart("cli-server", () => startCliServer());
onHostShutdown("cli-server", () => stopCliServer());
