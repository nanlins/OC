/**
 * web/api.ts —— Web 管理控制台 REST API
 *
 * 职责：只读投影（groups/messaging-groups/wirings/sessions/messages/tasks/approvals/audit/usage）+
 *       动作（approvals resolve、wirings create）；可选 Bearer token 鉴权（WEB_TOKEN）。
 * 关键导出：handleApiRequest, authorized, csrfOk, webTokenConfigured
 * 承重不变量：
 *   - Web 面只经 dispatch/resolveApproval 等既有守卫执行动作，不绕过 guard；
 *   - 审计只有一个源：中央库 guard_audit 表（由 modules/observability.ts 的 audit sink 写入，
 *     delivery-guard 每次判定触发）。/api/audit 直接读它，不存在第二套 JSONL 审计。
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 9）
 *   2026-08-13 阶段 14：错误响应接入 i18n（Accept-Language 协商 + code/本地化 error）；dispatch 传入请求 locale
 *   2026-10-06 P1-4：readBody 三态化，坏 JSON 回 400（原吞成 {} 导致误报 409 invalid-args）；
 *              明确 guard_audit 为唯一审计源（并删除死的 src/security/audit.ts JSONL 实现）
 *   2026-10-06 P2-4：删除不可达的 web-token 自动生成分支，注释改为如实描述"未配置=仅回环"
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { getDb } from "../db/connection.js";
import { inboundDbPath } from "../session-manager.js";
import { openInboundDb } from "../db/session-db.js";
import { listSessions } from "../db/sessions.js";
import { dispatch } from "../cli/dispatch.js";
import { WEB_TOKEN } from "../config.js";
import { readTrace, isSafeTraceId } from "../eval/trace.js";
import { t, negotiateLocale, resolveLocaleFromEnv, type Locale } from "../i18n/index.js";

/**
 * Web 面鉴权模型（P2-4 修复：行为与注释/文档对齐）。
 *
 * 两档，由 .env 的 WEB_TOKEN 决定，没有第三档：
 *   未配置 WEB_TOKEN —— 仅回环可达。authorized() 只放行 127.0.0.1/::1，配合
 *     WEB_HOST 默认 127.0.0.1（见 config.ts），非本机一律 401。不生成、不持久化任何 token。
 *   配置了 WEB_TOKEN —— fail-closed，恒要求 `Authorization: Bearer <WEB_TOKEN>`，
 *     空值/错值一律 401（定时比较，防时序侧信道）。
 *
 * 历史坑：此处曾有一个"未配置就自动生成随机 token 落到 data/web-token"的分支，注释也这么写，
 * 但 authorized() 在未配置时直接走回环信任、从不调用它 —— 那段生成逻辑 100% 不可达，
 * 且 docs/security.md 与 docs/api-reference.md 都按它描述行为。现删除死分支并改正文档，
 * 而不是反过来把回环信任改成强制 token（那会让本地打开控制台直接 401，且 token 无处可查）。
 */
export function webTokenConfigured(): boolean {
  return WEB_TOKEN.length > 0;
}

/**
 * @param configuredToken injectable so both branches are testable; defaults to the
 *   .env value. Pass null to exercise the loopback-only branch (vitest pins
 *   WEB_TOKEN, so the default alone could never reach it).
 */
export function authorized(req: IncomingMessage, configuredToken: string | null = WEB_TOKEN || null): boolean {
  if (!configuredToken) {
    const remote = req.socket?.remoteAddress ?? "";
    return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  }
  const h = req.headers.authorization ?? "";
  const expect = `Bearer ${configuredToken}`;
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
 * 请求体解析三态（P1-4 修复）。
 *
 * 原实现把 JSON.parse 失败吞成 {}，于是 {"id":...} 全变空串 → dispatch 报 invalid-args
 * → 外层回 409。客户端明明发的是坏 JSON，却收到"参数无效"，既误导又掩盖真实故障。
 * 现在 malformed 与 too-large 分开，各自映射 400 / 413。
 */
type BodyResult = { kind: "ok"; body: Record<string, unknown> } | { kind: "too-large" } | { kind: "malformed" };

async function readBody(req: IncomingMessage): Promise<BodyResult> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > MAX_BODY_BYTES) {
      // fix-plan P1：超限即停止累积（调用方回 413）。不再继续缓冲，防内存耗尽。
      return { kind: "too-large" };
    }
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return { kind: "ok", body: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "malformed" };
  }
  // JSON 合法但不是对象（如 `[]`、`"x"`、`3`）同样按 malformed 处理：调用方只接受对象体
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "malformed" };
  return { kind: "ok", body: parsed as Record<string, unknown> };
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
        // 唯一审计源：guard_audit（observability.ts 的 audit sink 写入）。P1-4：不再有第二套 JSONL。
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
    const parsedBody = await readBody(req);
    if (parsedBody.kind === "too-large") {
      // fix-plan P1：请求体超限（readBody 已停止累积），回 413
      errJson(res, 413, "api.err.payload_too_large", locale);
      return true;
    }
    if (parsedBody.kind === "malformed") {
      // P1-4：坏 JSON 回 400，不再伪装成 {} 让 dispatch 报 409 invalid-args
      errJson(res, 400, "api.err.malformed_json", locale);
      return true;
    }
    const body = parsedBody.body;
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
