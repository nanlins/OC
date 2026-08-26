/**
 * llm-proxy.ts —— 主机侧 LLM 密钥代理（OneCLI 网关的简化版）
 *
 * 职责：监听 0.0.0.0:8081，代理容器内 LLM 请求——剥 /llm-proxy 前缀后转发到真实
 *       OPENAI_BASE_URL，注入主机 .env 的 OPENAI_API_KEY，流式响应透传。
 *       容器侧只拿到代理地址（OC_LLM_PROXY_URL），永不接触真实密钥。
 * 关键导出：startLlmProxy, stopLlmProxy
 * 承重不变量：
 *   - 仅接受 Docker 网桥网段（172.16.0.0/12）与回环连接——其他来源 403（网关最小面）；
 *   - 密钥只从主机 .env 读取一次，绝不回传给容器；
 *   - 代理失败不阻塞主机主链路（错误仅日志）。
 * 借鉴：nanoclaw OneCLI 网关的"密钥不进容器"语义（简化：单机代理替代独立服务）。
 *
 * 修改记录：2026-08-26 创建（阶段 12：补齐 nanoclaw 密钥网关的简化形态）
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readEnvFile } from "./env.js";
import { ENV_PATH } from "./config.js";
import { log } from "./log.js";

export const LLM_PROXY_PORT = 8081;

/** 读主机密钥（.env 优先、process.env 兜底；读不到则代理返回 502 而非透传空 key） */
function hostCredentials(): { apiKey: string; baseUrl: string } | null {
  const dotenv = readEnvFile(["OPENAI_API_KEY", "OPENAI_BASE_URL"], ENV_PATH);
  const apiKey = dotenv.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseUrl = dotenv.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.deepseek.com/v1";
  if (!apiKey) return null;
  return { apiKey, baseUrl };
}

/** 来源 IP 白名单：Docker 网桥（172.16.0.0/12）+ 回环。其余 403（网关最小面） */
function isTrustedPeer(remoteAddress: string | undefined): boolean {
  const ip = remoteAddress ?? "";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  if (ip.startsWith("::ffff:")) return isTrustedPeer(ip.slice(7));
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  const first = parts[0]!;
  return first === 172 && parts[1]! >= 16 && parts[1]! <= 31; // 172.16.x.x - 172.31.x.x
}

let server: Server | null = null;

function proxyRequest(req: IncomingMessage, res: ServerResponse): void {
  const creds = hostCredentials();
  if (!creds) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "llm proxy: host OPENAI_API_KEY not configured" }));
    return;
  }

  // 剥 /llm-proxy 前缀，转发到真实 base + 剩余路径（含 query）
  const targetPath = (req.url ?? "/").replace(/^\/llm-proxy/, "") || "/";
  const target = new URL(creds.baseUrl + targetPath);
  const isHttps = target.protocol === "https:";

  const bodyChunks: Buffer[] = [];
  req.on("data", (c: Buffer) => bodyChunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(bodyChunks);
    const upstream = isHttps ? httpsRequest : httpRequest;
    const up = upstream(
      {
        host: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: req.method ?? "POST",
        headers: {
          "content-type": req.headers["content-type"] ?? "application/json",
          authorization: `Bearer ${creds.apiKey}`, // 密钥注入点：只有主机知道
          "content-length": String(body.length),
          accept: req.headers.accept ?? "application/json",
        },
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, {
          "content-type": upRes.headers["content-type"] ?? "text/event-stream",
          "cache-control": "no-cache",
        });
        upRes.pipe(res); // 流式 SSE 透传
      },
    );
    up.on("error", (err) => {
      log.error("llm proxy upstream failed", { err });
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "llm proxy upstream failed" }));
    });
    up.end(body);
  });
}

export function startLlmProxy(): void {
  if (server) return;
  server = createServer((req, res) => {
    try {
      if (!isTrustedPeer(req.socket?.remoteAddress)) {
        log.warn("llm proxy rejected untrusted peer", { ip: req.socket?.remoteAddress });
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      proxyRequest(req, res);
    } catch (err) {
      log.error("llm proxy request failed", { err });
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    }
  });
  server.listen(LLM_PROXY_PORT, "0.0.0.0", () => {
    log.info(`llm proxy listening: 0.0.0.0:${LLM_PROXY_PORT} (docker-bridge trusted only)`);
  });
  server.on("error", (err) => log.error("llm proxy server error", { err }));
}

export function stopLlmProxy(): void {
  if (!server) return;
  server.closeAllConnections();
  server.close();
  server = null;
}
