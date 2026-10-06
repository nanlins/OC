/**
 * llm-proxy.ts -- host-side LLM key proxy (simplified OneCLI gateway)
 *
 * Responsibility: accept LLM API calls from agent containers, inject the host's real
 * credential, forward to the real upstream, and stream the response back. Containers
 * only ever learn the proxy URL -- no real key crosses the boundary for ANY provider.
 *
 * Key exports: startLlmProxy, stopLlmProxy, LLM_PROXY_PORT, proxyUrlFor,
 *              isTrustedPeer, parseTrustedCidrs, resolveUpstream, matchProfile
 *
 * Invariants (load-bearing):
 *   1. Bind address defaults to 127.0.0.1 (fail-closed). Widening it requires an
 *      explicit OC_LLM_PROXY_HOST; 0.0.0.0 is never the default. On Docker Desktop a
 *      loopback bind is still reachable from containers (measured: the WSL/VPNKit relay
 *      re-originates the connection on the host loopback, so the proxy sees
 *      remoteAddress=127.0.0.1). Native Linux Docker needs the docker0 address instead.
 *   2. Peer allowlist is a CIDR list, default loopback + Docker's own bridges.
 *      NOT the whole 172.16.0.0/12 -- that is a million-address private range which
 *      also contains corporate/VPN hosts that have no business using our key.
 *   3. The upstream target is built with the URL parser and then re-validated
 *      (protocol, host, path prefix). A request path can never rewrite the hostname.
 *   4. Inbound credential headers are stripped before the host key is injected, so a
 *      container cannot smuggle its own credentials or exfiltrate ours by reflection.
 *   5. A proxy failure never blocks the host's main loop (errors are logged only).
 *   6. Host and port come from config (OC_LLM_PROXY_HOST / OC_LLM_PROXY_PORT) and
 *      proxyUrlFor derives the container-facing URL from the same values, so what a
 *      container is told and what the proxy bound cannot drift apart.
 *
 * Referenced: nanoclaw OneCLI gateway's "key never enters the container" semantics
 * (simplified: single-host proxy instead of a separate service).
 *
 * Modification record:
 *   2026-08-26  Created (phase 12)
 *   2026-10-06  P0-2: loopback-default bind; CIDR peer allowlist replacing the blanket
 *               172.16/12 trust; URL-parser-based target resolution with post-validation;
 *               anthropic profile added so claude stops receiving the real key;
 *               inbound auth headers stripped
 *   2026-10-06  T1-1: port configurable via OC_LLM_PROXY_PORT (8081 is taken by Docker
 *               Desktop's com.docker.backend/wslrelay on this host, which made the proxy
 *               unbindable and silently killed both proxied providers); loopback warning
 *               restricted to linux after measuring that Docker Desktop relays container
 *               traffic onto the host loopback; EADDRINUSE/EACCES now log the fix
 *   2026-10-06  T1-3: credential precedence flipped to process.env-then-.env (standard
 *               dotenv semantics) so a stale/invalid key in .env can be overridden by the
 *               environment without editing the file
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { readEnvFile } from "./env.js";
import { ENV_PATH, LLM_PROXY_HOST, LLM_PROXY_PORT, LLM_PROXY_TRUSTED_CIDRS } from "./config.js";
import { log } from "./log.js";

/**
 * Listening port, sourced from config (OC_LLM_PROXY_PORT, default 8081).
 * Re-exported here because providers/openai.ts and providers/claude.ts build the
 * container-facing proxy URL from it -- one value, so the URL handed to a container
 * can never disagree with the port the proxy actually bound.
 */
export { LLM_PROXY_PORT };

/** Upstream profiles: which credential to inject and under which header. */
export type ProxyProfile = "openai" | "anthropic";

const PROFILE_PREFIX: Record<ProxyProfile, string> = {
  openai: "/llm-proxy",
  anthropic: "/llm-proxy-anthropic",
};

const DEFAULT_ANTHROPIC_BASE = "https://api.anthropic.com";
const DEFAULT_OPENAI_BASE = "https://api.deepseek.com/v1";

/** Headers a container may set. Anything credential-bearing is deliberately absent. */
const FORWARD_HEADERS = ["content-type", "accept", "anthropic-version", "anthropic-beta"];
/** Stripped unconditionally: the host key is the only credential this proxy will send. */
const STRIP_HEADERS = ["authorization", "x-api-key", "anthropic-auth-token", "proxy-authorization"];

export interface UpstreamOk {
  ok: true;
  isHttps: boolean;
  hostname: string;
  port: string;
  path: string;
  apiKey: string;
  authHeader: "authorization" | "x-api-key";
}
export interface UpstreamBad {
  ok: false;
  reason: string;
}

interface Creds {
  openai: { apiKey: string; baseUrl: string } | null;
  anthropic: { apiKey: string; baseUrl: string } | null;
}

/** Exported for tests: the credential snapshot resolveUpstream works against. */
export type ProxyCreds = Creds;

/**
 * Read host credentials for one request.
 *
 * Precedence is process.env FIRST, then .env (T1-3). This deliberately inverts the
 * previous `dotenv.X || process.env.X` order, which contradicted the universal dotenv
 * convention that an explicitly-set environment variable wins. The old order made a
 * stale or invalid key in .env impossible to override without editing the file -- so
 * CI, a secret manager, or an operator rotating a key in their shell had no way in.
 * config.ts never writes .env values into process.env, so process.env only ever holds
 * what the operator or orchestrator actually set; preferring it is safe.
 *
 * The key itself is never logged. Only its presence and last-4 are safe to surface,
 * and this function does not surface either.
 */
function hostCredentials(): Creds {
  const dotenv = readEnvFile(
    ["OPENAI_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"],
    ENV_PATH,
  );
  const openaiKey = process.env.OPENAI_API_KEY || dotenv.OPENAI_API_KEY || "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY || dotenv.ANTHROPIC_API_KEY || "";
  return {
    openai: openaiKey
      ? { apiKey: openaiKey, baseUrl: process.env.OPENAI_BASE_URL || dotenv.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE }
      : null,
    anthropic: anthropicKey
      ? {
          apiKey: anthropicKey,
          baseUrl: process.env.ANTHROPIC_BASE_URL || dotenv.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE,
        }
      : null,
  };
}

/** Proxy URL a container should use for a given profile. */
export function proxyUrlFor(profile: ProxyProfile, hostGateway = "host.docker.internal"): string {
  return `http://${hostGateway}:${LLM_PROXY_PORT}${PROFILE_PREFIX[profile]}`;
}

/**
 * Longest-prefix match, so "/llm-proxy-anthropic" is never mistaken for "/llm-proxy".
 * Returns null when the request path is not a proxy path at all.
 */
export function matchProfile(url: string): { profile: ProxyProfile; remainder: string } | null {
  const path = url.split("?")[0] ?? "";
  let best: { profile: ProxyProfile; prefix: string } | null = null;
  for (const profile of Object.keys(PROFILE_PREFIX) as ProxyProfile[]) {
    const prefix = PROFILE_PREFIX[profile];
    if ((path === prefix || path.startsWith(prefix + "/")) && (!best || prefix.length > best.prefix.length)) {
      best = { profile, prefix };
    }
  }
  if (!best) return null;
  const queryStart = url.indexOf("?");
  const query = queryStart >= 0 ? url.slice(queryStart) : "";
  const stripped = best.prefix.length > 0 ? url.slice(best.prefix.length) : url;
  const withoutQuery = queryStart >= 0 ? stripped.slice(0, stripped.length - query.length) : stripped;
  return { profile: best.profile, remainder: (withoutQuery || "/") + query };
}

// ---- peer allowlist (invariant 2) ----

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export interface Cidr {
  net: number;
  mask: number;
}

/** Parse a comma-separated CIDR list; malformed entries are dropped (never widen trust). */
export function parseTrustedCidrs(raw: string): Cidr[] {
  const out: Cidr[] = [];
  for (const entry of raw.split(",")) {
    const item = entry.trim();
    if (!item) continue;
    const [net, bitsStr] = item.split("/");
    const netInt = ipv4ToInt(net ?? "");
    if (netInt === null) continue;
    const bits = bitsStr === undefined ? 32 : Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    out.push({ net: (netInt & mask) >>> 0, mask });
  }
  return out;
}

/** Normalize an IPv4-mapped IPv6 address ("::ffff:1.2.3.4") to its IPv4 form. */
function normalizeIp(remoteAddress: string | undefined): string {
  const ip = (remoteAddress ?? "").trim();
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:")) return lower.slice(7);
  return ip;
}

let trustedCidrs: Cidr[] | null = null;
function allowlist(): Cidr[] {
  if (!trustedCidrs) trustedCidrs = parseTrustedCidrs(LLM_PROXY_TRUSTED_CIDRS);
  return trustedCidrs;
}

/** Test-only: drop the memoized allowlist so a changed env is picked up. */
export function resetTrustedCidrsForTest(): void {
  trustedCidrs = null;
}

export function isTrustedPeer(remoteAddress: string | undefined, cidrs: Cidr[] = allowlist()): boolean {
  const ip = normalizeIp(remoteAddress);
  if (!ip) return false;
  if (ip === "::1") return true; // IPv6 loopback
  const asInt = ipv4ToInt(ip);
  if (asInt === null) return false; // IPv6 non-loopback: not in any trusted v4 range
  return cidrs.some(({ net, mask }) => (asInt & mask) >>> 0 === net);
}

// ---- upstream resolution (invariant 3) ----

/**
 * Resolve the real upstream for a proxied request.
 *
 * Uses the URL parser rather than string concatenation, then re-validates protocol,
 * host and path prefix. Two attack shapes are explicitly refused:
 *   - a remainder starting with "//" or "\\" -- WHATWG URL treats that as a
 *     protocol-relative reference and would silently swap the hostname;
 *   - ".." path segments -- would escape the configured API prefix.
 * The base path is preserved by joining onto base.origin (using
 * `new URL(path, baseUrl)` directly would drop e.g. DeepSeek's "/v1").
 */
export function resolveUpstream(profile: ProxyProfile, reqUrl: string, creds: Creds): UpstreamOk | UpstreamBad {
  const cred = creds[profile];
  if (!cred) {
    const keyName = profile === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    return { ok: false, reason: `host ${keyName} not configured` };
  }
  const matched = matchProfile(reqUrl);
  if (!matched || matched.profile !== profile) return { ok: false, reason: "not a proxy path" };
  const remainder = matched.remainder;

  const queryStart = remainder.indexOf("?");
  const rawPath = queryStart >= 0 ? remainder.slice(0, queryStart) : remainder;
  const query = queryStart >= 0 ? remainder.slice(queryStart) : "";

  if (!rawPath.startsWith("/")) return { ok: false, reason: "path must be absolute" };
  if (/^[/\\]{2}/.test(rawPath)) return { ok: false, reason: "protocol-relative path refused" };
  if (rawPath.includes("\\")) return { ok: false, reason: "backslash in path refused" };
  if (rawPath.split("/").some((seg) => seg === "..")) return { ok: false, reason: "path traversal refused" };

  let base: URL;
  try {
    base = new URL(cred.baseUrl);
  } catch {
    return { ok: false, reason: "host base URL is not parseable" };
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { ok: false, reason: "host base URL protocol must be http/https" };
  }

  let target: URL;
  try {
    target = new URL(base.pathname.replace(/\/+$/, "") + rawPath + query, base.origin);
  } catch {
    return { ok: false, reason: "upstream URL is not parseable" };
  }

  // Backstop: the resolved host must still be the configured host.
  if (target.hostname !== base.hostname || target.port !== base.port) {
    return { ok: false, reason: "resolved upstream host does not match configured base" };
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  if (basePath && !target.pathname.startsWith(basePath)) {
    return { ok: false, reason: "resolved path escapes the configured base path" };
  }

  return {
    ok: true,
    isHttps: target.protocol === "https:",
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? "443" : "80"),
    path: target.pathname + target.search,
    apiKey: cred.apiKey,
    authHeader: profile === "anthropic" ? "x-api-key" : "authorization",
  };
}

let server: Server | null = null;

function proxyRequest(req: IncomingMessage, res: ServerResponse, profile: ProxyProfile): void {
  const target = resolveUpstream(profile, req.url ?? "/", hostCredentials());
  if (!target.ok) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `llm proxy: ${target.reason}` }));
    return;
  }

  const bodyChunks: Buffer[] = [];
  req.on("data", (c: Buffer) => bodyChunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(bodyChunks);

    // Invariant 4: build the header set from an allowlist, so no container-supplied
    // credential header survives; then inject the host's own.
    const headers: Record<string, string> = { "content-length": String(body.length) };
    for (const name of FORWARD_HEADERS) {
      const v = req.headers[name];
      if (typeof v === "string" && v.length > 0) headers[name] = v;
    }
    for (const name of STRIP_HEADERS) delete headers[name];
    headers[target.authHeader] = target.authHeader === "authorization" ? `Bearer ${target.apiKey}` : target.apiKey;

    const upstream = target.isHttps ? httpsRequest : httpRequest;
    const up = upstream(
      {
        host: target.hostname,
        port: target.port,
        path: target.path,
        method: req.method ?? "POST",
        headers,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, {
          "content-type": upRes.headers["content-type"] ?? "application/json",
          "cache-control": "no-cache",
        });
        upRes.pipe(res); // stream SSE through untouched
      },
    );
    up.on("error", (err) => {
      log.error("llm proxy upstream failed", { err: String(err) });
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
        log.warn("llm proxy rejected untrusted peer", { ip: req.socket?.remoteAddress ?? "?" });
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      const matched = matchProfile(req.url ?? "");
      if (!matched) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unknown proxy path" }));
        return;
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      proxyRequest(req, res, matched.profile);
    } catch (err) {
      log.error("llm proxy request failed", { err: String(err) });
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    }
  });
  server.listen(LLM_PROXY_PORT, LLM_PROXY_HOST, () => {
    log.info(`llm proxy listening: ${LLM_PROXY_HOST}:${LLM_PROXY_PORT} (trusted cidrs: ${LLM_PROXY_TRUSTED_CIDRS})`);
    const loopback = LLM_PROXY_HOST === "127.0.0.1" || LLM_PROXY_HOST === "localhost" || LLM_PROXY_HOST === "::1";
    // T1-1 measured on Windows Docker Desktop 29.8.1: a container reaching
    // host.docker.internal arrives on the HOST LOOPBACK (remoteAddress=127.0.0.1),
    // because the WSL/VPNKit relay re-originates the connection there. So a loopback
    // bind IS reachable from containers on Docker Desktop and needs no warning.
    // Native Linux Docker is different: containers arrive via the docker0 gateway
    // (172.17.0.1), where a loopback bind is genuinely unreachable.
    if (loopback && process.platform === "linux") {
      log.warn(
        "llm proxy is bound to loopback on Linux: agent containers reach the host via the " +
          "docker0 gateway, not loopback, so proxy-based providers (openai/claude) will fail " +
          "from inside a container. Set OC_LLM_PROXY_HOST=172.17.0.1 (or 0.0.0.0 -- the peer " +
          "allowlist OC_LLM_PROXY_TRUSTED_CIDRS still restricts who may connect).",
      );
    }
  });
  server.on("error", (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE" || code === "EACCES") {
      // Actionable: both openai and claude providers depend on this proxy to inject the
      // key, so a port clash silently kills the whole LLM path. Say how to fix it.
      log.error(
        `llm proxy cannot bind ${LLM_PROXY_HOST}:${LLM_PROXY_PORT} (${code}). ` +
          `Another process holds that port -- on this host 8081 is commonly taken by Docker ` +
          `Desktop's com.docker.backend / wslrelay. Set OC_LLM_PROXY_PORT to a free port ` +
          `(e.g. 18081); containers are told the new port automatically.`,
        { err: String(err) },
      );
      return;
    }
    log.error("llm proxy server error", { err: String(err) });
  });
}

export function stopLlmProxy(): void {
  if (!server) return;
  server.closeAllConnections();
  server.close();
  server = null;
}

/*
 * Modification record:
 *   2026-08-26  Created (phase 12)
 *   2026-10-06  P0-2: loopback-default bind + CIDR allowlist + URL-parser target resolution
 *               with post-validation + anthropic profile + inbound auth header stripping
 */
