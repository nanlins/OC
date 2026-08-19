/**
 * web/server.ts —— Web 管理控制台 HTTP 服务（REST + SSE + 静态前端）
 *
 * 职责：node http server；/api/* 经 api.ts；/events SSE 订阅事件总线；/ 静态前端（static/）。
 * 关键导出：startWebServer, stopWebServer
 * 承重不变量：动作面只经 dispatch/既有守卫；未配置 WEB_TOKEN 时仅本机信任（文档声明）。
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 9）
 *   2026-08-13 阶段 14：SSE 401 / 静态 404 / 500 错误接入 i18n
 */
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve as resolvePath, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WEB_PORT, PROJECT_ROOT } from "../config.js";
import { onHostStart, onHostShutdown } from "../host-lifecycle.js";
import { handleApiRequest, authorized } from "./api.js";
import { subscribeWebEvents, registerWebHooks } from "./events.js";
import { registerAllResources } from "../cli/resources.js";
import { log } from "../log.js";
import { t, negotiateLocale, resolveLocaleFromEnv } from "../i18n/index.js";

const STATIC_DIR = resolvePath(fileURLToPath(import.meta.url), "..", "static");
// fix-plan P2：React 生产构建（web/frontend/dist）若存在则优先服务，回退旧版静态控制台
const REACT_DIST_DIR = resolvePath(PROJECT_ROOT, "web", "frontend", "dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

/** 选择静态根：React 构建产物优先（fix-plan P2），否则旧版控制台 */
export function resolveStaticDir(): string {
  return existsSync(resolvePath(REACT_DIST_DIR, "index.html")) ? REACT_DIST_DIR : STATIC_DIR;
}

let server: Server | null = null;
let serverPort: number | null = null;

export function startWebServer(port: number = WEB_PORT): Promise<number> {
  registerWebHooks();
  registerAllResources(); // API 动作面依赖 CLI 命令注册表
  if (server && serverPort !== null) return Promise.resolve(serverPort); // P2-3 修复：启动幂等
  return new Promise((resolve, reject) => {
    const srv = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const locale = negotiateLocale(req.headers["accept-language"], resolveLocaleFromEnv());
      try {
        if (await handleApiRequest(req, res, url)) return;
        if (url.pathname === "/events") {
          // P1-2 修复：SSE 数据面同样鉴权
          if (!authorized(req)) {
            res.writeHead(401, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: t("api.err.unauthorized", locale), code: "api.err.unauthorized" }));
            return;
          }
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
          const unsub = subscribeWebEvents((ev) => {
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
          });
          req.on("close", unsub);
          return;
        }
        // 静态前端（P2-7 修复：resolve 容纳校验 + isFile；fix-plan P2：React dist 优先）
        const staticDir = resolveStaticDir();
        const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
        const p = resolvePath(staticDir, file.split("/").filter(Boolean).join("/"));
        const ext = extname(p);
        if (p.startsWith(resolvePath(staticDir) + sep) && existsSync(p) && statSync(p).isFile() && MIME[ext]) {
          res.writeHead(200, { "content-type": MIME[ext] });
          res.end(readFileSync(p));
          return;
        }
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end(t("api.err.not_found", locale));
      } catch (err) {
        log.error("web request failed", { err });
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: t("api.err.internal", locale), code: "api.err.internal" }));
      }
    });
    srv.listen(port, "127.0.0.1", () => {
      const actual = (srv.address() as { port: number }).port;
      log.info(`web console listening: http://127.0.0.1:${actual}`);
      server = srv;
      serverPort = actual;
      srv.on("error", (err) => log.error("web server error", { err })); // P2-9 修复：listen 后错误改 log
      resolve(actual);
    });
    srv.on("error", reject);
  });
}

/** P1-3 修复：终止存量 SSE 长连接，防优雅关停挂起 */
export async function stopWebServer(): Promise<void> {
  const srv = server;
  server = null;
  serverPort = null;
  if (!srv) return;
  srv.closeAllConnections();
  await new Promise<void>((resolve) => srv.close(() => resolve()));
}

onHostStart("web-server", () => {
  void startWebServer().catch((err) => log.error("web server failed to start", { err }));
});
onHostShutdown("web-server", () => stopWebServer());
