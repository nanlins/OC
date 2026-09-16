/**
 * web/server.ts —— Web 管理控制台 HTTP 服务（REST + SSE + 静态前端）
 *
 * 职责：node http server；/health 存活探针；/api/* 经 api.ts；/events SSE 订阅事件总线；/ 静态前端（static/）。
 * 关键导出：startWebServer, stopWebServer, resolveStaticDir
 * 承重不变量：动作面只经 dispatch/既有守卫；未配置 WEB_TOKEN 时仅本机信任（文档声明）；
 *   /health 不鉴权但只回 {ok:true}，不泄露版本/路径/计数；监听地址由 WEB_HOST 决定，
 *   默认 127.0.0.1，绑非回环且无 WEB_TOKEN 时启动告警（静态外壳会对外可达）。
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 9）
 *   2026-08-13 阶段 14：SSE 401 / 静态 404 / 500 错误接入 i18n
 *   2026-09-16 新增 /health 存活探针（docker-compose healthcheck 此前打的是一个不存在的端点）；
 *              监听地址改为可配置 WEB_HOST（此前硬编 127.0.0.1，容器内发布端口从宿主不可达）
 */
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve as resolvePath, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WEB_PORT, WEB_HOST, WEB_TOKEN, PROJECT_ROOT } from "../config.js";
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
        // 存活探针：不鉴权（编排器的 healthcheck 无法带 Bearer），也绝不泄露信息——
        // 只回 {ok:true}，不含版本/路径/计数。放在 handleApiRequest 之前，避免被 /api/* 吞掉。
        if (url.pathname === "/health") {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end('{"ok":true}');
          return;
        }
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
    srv.listen(port, WEB_HOST, () => {
      const actual = (srv.address() as { port: number }).port;
      log.info(`web console listening: http://${WEB_HOST}:${actual}`);
      if (WEB_HOST !== "127.0.0.1" && WEB_HOST !== "localhost" && !WEB_TOKEN) {
        // 非回环绑定 + 未显式配置 WEB_TOKEN：/api/* 与 /events 仍按 remoteAddress 只放行回环，
        // 但静态前端外壳会对外可达。提示运维显式决策，而不是静默暴露。
        log.warn("web console bound to a non-loopback address without WEB_TOKEN; static shell is publicly reachable");
      }
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
