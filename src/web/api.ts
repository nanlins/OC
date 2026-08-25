/**
 * web/api.ts —— Web 管理控制台 REST API
 *
 * 职责：只读投影（groups/messaging-groups/wirings/sessions/messages/tasks/approvals/audit/usage）+
 *       动作（approvals resolve、wirings create）；可选 Bearer token 鉴权（WEB_TOKEN）。
 * 关键导出：handleApiRequest
 * 承重不变量：Web 面只经 dispatch/resolveApproval 等既有守卫执行动作，不绕过 guard。
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 9）
 *   2026-08-13 阶段 14：错误响应接入 i18n（Accept-Language 协商 + code/本地化 error）；dispatch 传入请求 locale
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import { inboundDbPath } from "../session-manager.js";
import { openInboundDb } from "../db/session-db.js";
import { listSessions } from "../db/sessions.js";
import { dispatch } from "../cli/dispatch.js";
import { WEB_TOKEN, DATA_DIR } from "../config.js";
import { readTrace, isSafeTraceId } from "../eval/trace.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../log.js";
import { t, negotiateLocale, resolveLocaleFromEnv, type Locale } from "../i18n/index.js";

let cachedToken: string | null = null;

/**
 * fix-plan P0（fail-closed）：WEB_TOKEN 配置则用之；否则生成随机 token 并持久化到
 * DATA_DIR/web-token（存在则读取）。绝不允许"空 token = 全开放"。
 */
export function getOrInitWebToken(): string {
  if (cachedToken) return cachedToken;
  if (WEB_TOKEN) {
    cachedToken = WEB_TOKEN;
    return cachedToken;
  }
  const tokenFile = join(DATA_DIR, "web-token");
  try {
    if (existsSync(tokenFile)) {
      const existing = readFileSync(tokenFile, "utf8").trim();
      if (existing) {
        cachedToken = existing;
        return cachedToken;
      }
    }
  } catch {
    /* 落入生成 */
  }
  const generated = randomBytes(24).toString("base64url");
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(tokenFile, generated + "\n", { mode: 0o600 });
    log.info(`web token generated -> ${tokenFile}（fail-closed；可设 WEB_TOKEN 覆盖）`);
  } catch (err) {
    log.warn("web token persist failed; in-memory only", { err });
  }
  cachedToken = generated;
  return cachedToken;
}

/** 仅供测试重置缓存 */
export function resetWebTokenForTest(): void {
  cachedToken = null;
}

export function authorized(req: IncomingMessage): boolean {
  // 未配置 WEB_TOKEN：本机信任——server 只绑定 127.0.0.1，仅回环可达（设计文档声明的默认口径）；
  // 配置了 WEB_TOKEN：fail-closed，恒要求有效 Bearer（空 token 不生效，fix-plan P0）。
  if (!WEB_TOKEN) {
    const remote = req.socket?.remoteAddress ?? "";
    return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  }
  const token = getOrInitWebToken();
  const h = req.headers.authorization ?? "";
  const expect = `Bearer ${token}`;
  const a = Buffer.from(h);
  const b = Buffer.from(expect);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * fix-plan P0（CSRF）：状态变更请求的跨站防御。Bearer token 本身不会随跨站请求自动携带；
 * 此处纵深拒绝浏览器 cross-site（Sec-Fetch-Site=cross-site，或 Origin 与 Host 不同源）。
 */
export function csrfOk(req: IncomingMessage): boolean {
  const sfs = req.headers["sec-fetch-site"];
  if (typeof sfs === "string" && sfs === "cross-site") return false;
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    const host = req.headers.host ?? "";
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** 请求 locale：Accept-Language 协商 → OC_LOCALE → en（阶段 14） */
function reqLocale(req: IncomingMessage): Locale {
  return negotiateLocale(req.headers["accept-language"], resolveLocaleFromEnv());
}

/** 本地化错误响应：{ error: 本地化文案, code: 稳定 message id }（前端可按 code 再译） */
function errJson(res: ServerResponse, status: number, key: string, locale: Locale): void {
  json(res, status, { error: t(key, locale), code: key });
}

const MAX_BODY_BYTES = 1024 * 1024; // P2-5 修复：体积上限防内存耗尽

/**
 * fix-plan P1：超限立即停止累积并断开，返回 null 供调用方回 413（不再静默返回 {} 且挂住连接）。
 */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > MAX_BODY_BYTES) {
      // fix-plan P1：超限即停止累积并返回 null（调用方回 413）。不再继续缓冲，防内存耗尽。
      return null;
    }
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 只读投影查询（表名/列白名单内联，防注入） */
function listTable(
  table:
    | "agent_groups"
    | "messaging_groups"
    | "messaging_group_agents"
    | "user_roles"
    | "pending_approvals"
    | "unregistered_senders",
): unknown[] {
  const cols: Record<string, string> = {
    agent_groups: "id, name, folder, agent_provider, created_at",
    messaging_groups: "id, channel_type, platform_id, instance, unknown_sender_policy, denied_at, created_at",
    messaging_group_agents: "id, messaging_group_id, agent_group_id, engage_mode, sender_scope, session_mode, priority",
    user_roles: "user_id, role, agent_group_id, granted_at",
    pending_approvals: "id, action, status, title, agent_group_id, created_at",
    unregistered_senders: "messaging_group_id, sender_id, display_name, message_count, last_seen",
  };
  return getDb().prepare(`SELECT ${cols[table]} FROM ${table} ORDER BY rowid DESC LIMIT 500`).all() as unknown[];
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return false;
  const locale = reqLocale(req);
  if (!authorized(req)) {
    errJson(res, 401, "api.err.unauthorized", locale);
    return true;
  }
  const db = getDb();

  // ---- GET 投影 ----
  if (req.method === "GET") {
    switch (path) {
      case "/api/groups":
        json(res, 200, listTable("agent_groups"));
        return true;
      case "/api/messaging-groups":
        json(res, 200, listTable("messaging_groups"));
        return true;
      case "/api/wirings":
        json(res, 200, listTable("messaging_group_agents"));
        return true;
      case "/api/roles":
        json(res, 200, listTable("user_roles"));
        return true;
      case "/api/approvals":
        json(res, 200, listTable("pending_approvals"));
        return true;
      case "/api/dropped":
        json(res, 200, listTable("unregistered_senders"));
        return true;
      case "/api/audit":
        json(res, 200, db.prepare("SELECT * FROM guard_audit ORDER BY id DESC LIMIT 500").all());
        return true;
      case "/api/usage":
        json(res, 200, db.prepare("SELECT * FROM usage_daily ORDER BY rowid DESC LIMIT 500").all());
        return true;
      case "/api/sessions":
        json(res, 200, listSessions());
        return true;
      default: {
        const tm = /^\/api\/traces\/([^/]+)$/.exec(path);
        if (tm) {
          // fix-plan P0：解码后校验 id 不得逃逸 traces 目录（防路径穿越），非法返回 400
          let traceId = "";
          try {
            traceId = decodeURIComponent(tm[1] ?? "");
          } catch {
            errJson(res, 400, "api.err.bad_request", locale);
            return true;
          }
          if (!isSafeTraceId(traceId)) {
            errJson(res, 400, "api.err.bad_request", locale);
            return true;
          }
          json(res, 200, readTrace(traceId));
          return true;
        }
        const m = /^\/api\/sessions\/([^/]+)\/messages$/.exec(path);
        if (m) {
          const session = listSessions().find((s) => s.id === m[1]);
          if (!session || !existsSync(inboundDbPath(session.agent_group_id, session.id))) {
            errJson(res, 404, "api.err.session_not_found", locale);
            return true;
          }
          const inbound = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
          try {
            json(
              res,
              200,
              inbound
                .prepare(
                  "SELECT id, kind, status, trigger, content, timestamp FROM messages_in ORDER BY seq DESC LIMIT 200",
                )
                .all(),
            );
          } finally {
            inbound.close();
          }
          return true;
        }
        errJson(res, 404, "api.err.not_found", locale);
        return true;
      }
    }
  }

  // ---- POST 动作（经既有守卫） ----
  if (req.method === "POST") {
    // fix-plan P0：状态变更先过 CSRF 纵深校验（拒绝浏览器 cross-site）
    if (!csrfOk(req)) {
      errJson(res, 403, "api.err.forbidden", locale);
      return true;
    }
    const body = await readBody(req);
    if (body === null) {
      // fix-plan P1：请求体超限（readBody 已断开连接），回 413
      errJson(res, 413, "api.err.payload_too_large", locale);
      return true;
    }
    // P2-1 修复：body 值空白校验，防 cmd 分词注入额外 flag
    const safeToken = (v: unknown): string => {
      const s = String(v ?? "");
      return /^\S+$/.test(s) ? s : "";
    };
    if (path === "/api/approvals/resolve") {
      const cmd = `approvals resolve ${safeToken(body.id)} --decision ${safeToken(body.decision)}`;
      const out = await dispatch({ cmd, requestId: randomUUID() }, { actor: "host" }, locale);
      json(res, out.ok ? 200 : 409, out);
      return true;
    }
    if (path === "/api/wirings") {
      const cmd = `wirings create --messaging-group ${safeToken(body.messagingGroupId)} --agent-group ${safeToken(body.agentGroupId)}`;
      const out = await dispatch({ cmd, requestId: randomUUID() }, { actor: "host" }, locale);
      json(res, out.ok ? 201 : 409, out);
      return true;
    }
    errJson(res, 404, "api.err.not_found", locale);
    return true;
  }

  errJson(res, 405, "api.err.method_not_allowed", locale);
  return true;
}
