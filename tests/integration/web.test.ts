/**
 * web.test.ts —— Web 管理控制台测试（REST 投影 + 审批动作 + SSE）
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 9）
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
import { existsSync, readdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { PROJECT_ROOT } from "../../src/config.js";
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
    expect(html).toContain("OpenClaw 管理控制台");
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
});
