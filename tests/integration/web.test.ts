/**
 * web.test.ts —— Web 管理控制台测试（REST 投影 + 审批动作 + SSE）
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 9）
 *   2026-09-16 补 /health 存活探针测试（docker-compose healthcheck 此前打的是一个不存在的端点）
 *   2026-10-06 P1-4：坏 JSON → 400（非对象 JSON 同样 400，空体仍 409）；/api/audit 与
 *              queryGuardAudit 读同一 guard_audit 源的一致性断言
 *              P2-4：authorized 的两档模型（配置 token / 仅回环）逐分支覆盖，并断言不再生成 web-token
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  closeDb,
  initTestDb,
  runMigrations,
  createAgentGroup,
  createMessagingGroup,
  createWiring,
} from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";
import { startWebServer, stopWebServer, resolveStaticDir } from "../../src/web/server.js";
import { authorized, webTokenConfigured } from "../../src/web/api.js";
import { getDeliveryAction, registerDeliveryAction } from "../../src/delivery.js";
import { queryGuardAudit } from "../../src/modules/observability.js";
import { defineGuardedAction, ALLOW } from "../../src/guard/index.js";
import { resolveSession } from "../../src/session-manager.js";
import { existsSync, readdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { IncomingMessage } from "node:http";
import { PROJECT_ROOT, DATA_DIR } from "../../src/config.js";
import "../../src/modules/index.js"; // 副作用：注册模块迁移（guard_audit / usage_daily）+ 审计 sink
void stopWebServer;
import { publishWebEvent } from "../../src/web/events.js";

let port: number;
// fix-plan P0：WEB_TOKEN fail-closed，测试经 vitest.config 注入 test-web-token
const AUTH = { authorization: "Bearer test-web-token" };

beforeEach(async () => {
  runMigrations(initTestDb(), [migration001]);
  port = await startWebServer(0);
});

afterEach(() => {
  stopWebServer();
  closeDb();
});

describe("web api", () => {
  it("/health 存活探针：不鉴权、只回 {ok:true}、不泄露信息", async () => {
    // 编排器的 healthcheck 无法带 Bearer，所以这个端点必须免鉴权
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toBe('{"ok":true}');
    // 不得泄露版本/路径/计数等任何额外字段
    expect(Object.keys(JSON.parse(body) as Record<string, unknown>)).toEqual(["ok"]);
  });

  it("serves read-only projections", async () => {
    const g = createAgentGroup({ name: "W", folder: `w-${Math.random().toString(36).slice(2, 6)}` });
    const mg = createMessagingGroup({ channelType: "mock", platformId: "p1" });
    createWiring({ messagingGroupId: mg.id, agentGroupId: g.id });
    const groups = await (await fetch(`http://127.0.0.1:${port}/api/groups`, { headers: AUTH })).json();
    expect((groups as Array<Record<string, unknown>>).length).toBe(1);
    const wirings = await (await fetch(`http://127.0.0.1:${port}/api/wirings`, { headers: AUTH })).json();
    expect((wirings as Array<Record<string, unknown>>).length).toBe(1);
    const sessions = await (await fetch(`http://127.0.0.1:${port}/api/sessions`, { headers: AUTH })).json();
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("creates wiring via POST and rejects unknown api", async () => {
    const g = createAgentGroup({ name: "W2", folder: `w2-${Math.random().toString(36).slice(2, 6)}` });
    const mg = createMessagingGroup({ channelType: "mock", platformId: "p2" });
    const res = await fetch(`http://127.0.0.1:${port}/api/wirings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...AUTH },
      body: JSON.stringify({ messagingGroupId: mg.id, agentGroupId: g.id }),
    });
    expect(res.status).toBe(201);
    const unknown = await fetch(`http://127.0.0.1:${port}/api/nope`, { headers: AUTH });
    expect(unknown.status).toBe(404);
  });

  it("SSE delivers published events", async () => {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/events`, { signal: controller.signal, headers: AUTH });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader!.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("hello");
    publishWebEvent("test-event", { n: 1 });
    const second = await reader!.read();
    expect(new TextDecoder().decode(second.value)).toContain("test-event");
    controller.abort();
  });

  it("static frontend served at /", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("OC 管理控制台");
  });

  it("build:web — React dist preferred and hashed assets served (fix-plan P2 regression)", async () => {
    const distIndex = resolvePath(PROJECT_ROOT, "web", "frontend", "dist", "index.html");
    if (!existsSync(distIndex)) return; // 未构建则跳过（CI 先 build:web 再测）
    // 静态根应指向 React dist
    expect(resolveStaticDir()).toBe(resolvePath(PROJECT_ROOT, "web", "frontend", "dist"));
    // / 应为 React 入口
    const home = await fetch(`http://127.0.0.1:${port}/`);
    expect(home.status).toBe(200);
    // dist/assets 下的 .js 应可服务且 MIME 正确
    const assetsDir = resolvePath(PROJECT_ROOT, "web", "frontend", "dist", "assets");
    const js = readdirSync(assetsDir).find((f) => f.endsWith(".js"));
    expect(js).toBeDefined();
    const res = await fetch(`http://127.0.0.1:${port}/assets/${js}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
  });

  it("static traversal attempts 404 (P2-7 regression)", async () => {
    for (const p of ["/../package.json", "/..%2fpackage.json", "/....//package.json", "/static/../../package.json"]) {
      const res = await fetch(`http://127.0.0.1:${port}${p}`);
      expect(res.status).toBe(404);
    }
  });

  it("traces endpoint rejects path traversal (fix-plan P0 regression)", async () => {
    // 编码后的 ..%2F 解码为 ../，必须被拒（400），不得读取 traces 目录之外
    for (const id of ["..%2F..%2Fpackage", "..%2Fv2.db", "a%2F..%2Fb", "%2e%2e%2fsecret"]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/traces/${id}`, { headers: AUTH });
      expect(res.status).toBe(400);
    }
    // 合法 id（不存在）应返回 200 + 空数组
    const ok = await fetch(`http://127.0.0.1:${port}/api/traces/some-valid-session`, { headers: AUTH });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([]);
  });

  it("fail-closed auth: missing/invalid token rejected (fix-plan P0 regression)", async () => {
    const noToken = await fetch(`http://127.0.0.1:${port}/api/groups`);
    expect(noToken.status).toBe(401);
    const badToken = await fetch(`http://127.0.0.1:${port}/api/groups`, { headers: { authorization: "Bearer wrong" } });
    expect(badToken.status).toBe(401);
  });

  it("CSRF: cross-site Origin on POST rejected (fix-plan P0 regression)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/wirings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...AUTH, origin: "http://evil.example.com" },
      body: JSON.stringify({ messagingGroupId: "x", agentGroupId: "y" }),
    });
    expect(res.status).toBe(403);
  });

  it("oversized POST body returns 413 (fix-plan P1 regression)", async () => {
    const big = "x".repeat(1024 * 1024 + 1024); // > 1MB 上限
    const res = await fetch(`http://127.0.0.1:${port}/api/wirings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...AUTH },
      body: JSON.stringify({ messagingGroupId: big, agentGroupId: "y" }),
    });
    expect(res.status).toBe(413);
  });

  it("approvals resolve via web closes the loop (approve path)", async () => {
    const { createPendingApproval } = await import("../../src/modules/approvals.js");
    const row = createPendingApproval({
      sessionId: "web-approve",
      action: "cli_command",
      payload: { cmd: "groups list", caller: { actor: "host" } },
      title: "t",
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/approvals/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", ...AUTH },
      body: JSON.stringify({ id: row.id, decision: "approve" }),
    });
    expect(res.status).toBe(200);
    const { getPendingApproval } = await import("../../src/modules/approvals.js");
    expect(getPendingApproval(row.id)).toBeUndefined();
  });

  it("stopWebServer terminates SSE connections (P1-3 regression)", async () => {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/events`, { signal: controller.signal, headers: AUTH });
    expect(res.status).toBe(200);
    await stopWebServer();
    // 连接应被服务端终止：done 或 reject(terminated) 均为终止形态
    const reader = res.body?.getReader();
    let terminated = false;
    try {
      for (let i = 0; i < 10 && !terminated; i++) {
        const next = await reader!.read();
        terminated = next.done;
      }
    } catch {
      terminated = true; // other side closed = 服务端已终止连接
    }
    expect(terminated).toBe(true);
    controller.abort();
    // 重启供 afterEach stop 幂等
    port = await startWebServer(0);
  });

  it("P1-4: malformed JSON body returns 400, not 409 invalid-args", async () => {
    for (const body of ["{not json", '{"id":', "trailing garbage}", "{'single':'quotes'}"]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/approvals/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body,
      });
      expect(res.status, body).toBe(400);
      const json = (await res.json()) as { code?: string };
      expect(json.code).toBe("api.err.malformed_json");
    }
  });

  it("P1-4: valid JSON that is not an object is also 400", async () => {
    for (const body of ["[]", '"a string"', "42", "null"]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/wirings`, {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body,
      });
      expect(res.status, body).toBe(400);
    }
  });

  it("P1-4: an empty body is still accepted (400 is reserved for malformed input)", async () => {
    // No body at all means "no fields supplied", which is a validation problem for the
    // handler (409), not a parse problem -- the two must stay distinguishable.
    const res = await fetch(`http://127.0.0.1:${port}/api/approvals/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", ...AUTH },
    });
    expect(res.status).toBe(409);
  });

  it("P1-4: /api/audit reads the single guard_audit source, consistent with the module reader", async () => {
    // Write through the real guard sink (delivery-guard -> observability -> guard_audit),
    // then read the same row back through BOTH readers. This is the acceptance for
    // "audit data readable consistently between Web and the security module" -- there
    // is exactly one source now that the dead JSONL writer is gone.
    const action = defineGuardedAction("web-audit-probe", { decide: () => ALLOW("ok") });
    registerDeliveryAction("web_audit_probe", { guard: { guardAction: action }, handler: async () => {} });
    // Created inside this test, not in beforeEach: /api/groups projections elsewhere
    // assert an exact row count.
    const agentGroupId = createAgentGroup({
      name: "WA",
      folder: `wa-${Math.random().toString(36).slice(2, 8)}`,
    }).id;
    const session = resolveSession({ agentGroupId, sessionMode: "agent-shared" });
    const wrapped = getDeliveryAction("web_audit_probe");
    await wrapped!(
      {
        id: "o-web-1",
        seq: 1,
        in_reply_to: null,
        timestamp: new Date().toISOString(),
        deliver_after: null,
        recurrence: null,
        kind: "system",
        operation: null,
        platform_id: null,
        channel_type: "mock",
        thread_id: null,
        content: "{}",
      },
      session,
    );

    const viaModule = queryGuardAudit("web-audit-probe");
    expect(viaModule.length).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/api/audit`, { headers: AUTH });
    expect(res.status).toBe(200);
    const viaWeb = (await res.json()) as Array<Record<string, unknown>>;
    const matched = viaWeb.filter((r) => r.action === "web-audit-probe");
    expect(matched.length).toBe(viaModule.length);
    expect(matched[0]?.decision).toBe(viaModule[0]!.decision);
    expect(matched[0]?.id).toBe(viaModule[0]!.id);
  });
});

describe("P2-4: web auth model matches its documentation", () => {
  function fakeReq(remoteAddress: string, authorization?: string): IncomingMessage {
    return { socket: { remoteAddress }, headers: authorization ? { authorization } : {} } as unknown as IncomingMessage;
  }

  it("reports whether a token is configured", () => {
    // vitest pins WEB_TOKEN=test-web-token, so the configured branch is the default here
    expect(webTokenConfigured()).toBe(true);
  });

  it("with a token configured: requires the exact Bearer value", () => {
    expect(authorized(fakeReq("203.0.113.9", "Bearer test-web-token"), "test-web-token")).toBe(true);
    expect(authorized(fakeReq("203.0.113.9", "Bearer wrong"), "test-web-token")).toBe(false);
    expect(authorized(fakeReq("203.0.113.9"), "test-web-token")).toBe(false);
    expect(authorized(fakeReq("203.0.113.9", "test-web-token"), "test-web-token")).toBe(false);
    // A non-loopback caller is NOT let in just because a token exists elsewhere.
    expect(authorized(fakeReq("203.0.113.9", "Bearer "), "test-web-token")).toBe(false);
  });

  it("with no token configured: loopback only, and no token is generated or persisted", () => {
    for (const loopback of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(authorized(fakeReq(loopback), null), loopback).toBe(true);
      // A Bearer header is irrelevant in this mode -- the address is the whole policy.
      expect(authorized(fakeReq(loopback, "Bearer anything"), null)).toBe(true);
    }
    for (const remote of ["203.0.113.9", "192.168.1.5", "10.0.0.2", "fe80::1", ""]) {
      expect(authorized(fakeReq(remote), null), remote).toBe(false);
      expect(authorized(fakeReq(remote, "Bearer anything"), null), remote).toBe(false);
    }
    // The removed dead branch used to write DATA_DIR/web-token; it must not exist.
    expect(existsSync(resolvePath(DATA_DIR, "web-token"))).toBe(false);
  });
});
