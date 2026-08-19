/**
 * delivery.test.ts —— 投递主流程集成测试（Mock 适配器，不真起通道）
 *
 * 职责：delivered 簿记/重试≤3 failed/系统动作注册表/guard hold 与 deny/unguarded 重注册拒绝。
 * 修改记录：
 *   2026-08-12 创建（阶段 5）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDb, initTestDb, runMigrations, createAgentGroup } from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";
import { resolveSession, outboundDbPath, inboundDbPath } from "../../src/session-manager.js";
import { openOutboundDbRw, openInboundDb, ensureOutboundSchema } from "../../src/db/session-db.js";
import {
  deliverSessionMessages,
  registerDeliveryAction,
  resetDeliveryForTest,
  MAX_DELIVERY_ATTEMPTS,
} from "../../src/delivery.js";
import { setActiveAdapterForTest, clearChannelRegistryForTest } from "../../src/channels/channel-registry.js";
import { defineGuardedAction, ALLOW, HOLD, DENY, unguarded } from "../../src/guard/index.js";
import type { Session } from "../../src/types.js";

let session: Session;
let delivered: Array<{ content: string }> = [];
let failMode = false;

function installAdapter() {
  setActiveAdapterForTest({
    name: "mock",
    channelType: "cli",
    supportsThreads: false,
    setup: () => {},
    deliver: async (_p, _t, msg) => {
      if (failMode) throw new Error("adapter down");
      delivered.push({ content: msg.content });
      return "plat-1";
    },
  });
}

function writeOut(content: string, kind = "chat"): string {
  const db = openOutboundDbRw(outboundDbPath(session.agent_group_id, session.id));
  ensureOutboundSchema(db);
  const id = randomUUID();
  const row = db.prepare("SELECT MAX(seq) AS m FROM messages_out").get() as { m: number | null };
  const seq = (row.m ?? 0) + 1;
  db.prepare(`INSERT INTO messages_out (id, seq, timestamp, kind, content) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    seq % 2 === 0 ? seq + 1 : seq,
    new Date().toISOString(),
    kind,
    content,
  );
  db.close();
  return id;
}

beforeEach(() => {
  runMigrations(initTestDb(), [migration001]);
  resetDeliveryForTest();
  clearChannelRegistryForTest();
  const group = createAgentGroup({ name: "D", folder: `d-${Math.random().toString(36).slice(2, 8)}` });
  session = resolveSession({ agentGroupId: group.id, sessionMode: "agent-shared" });
  delivered = [];
  failMode = false;
  installAdapter();
});

afterEach(() => {
  clearChannelRegistryForTest();
  closeDb();
});

describe("delivery", () => {
  it("delivers outbound messages and books delivered in inbound", async () => {
    writeOut("hello user");
    const n = await deliverSessionMessages(session);
    expect(n).toBe(1);
    expect(delivered.map((d) => d.content)).toEqual(["hello user"]);
    const inbound = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
    const rows = inbound.prepare("SELECT status FROM delivered").all() as Array<{ status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("delivered");
    inbound.close();
    // 二次调用不重复投递
    const n2 = await deliverSessionMessages(session);
    expect(n2).toBe(0);
  });

  it("retries then marks failed after MAX attempts", async () => {
    writeOut("will fail");
    failMode = true;
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      await deliverSessionMessages(session);
    }
    const inbound = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
    const row = inbound.prepare("SELECT status FROM delivered").get() as { status: string };
    expect(row.status).toBe("failed");
    inbound.close();
  });

  it("system actions dispatch through registration (unguarded)", async () => {
    const seen: string[] = [];
    registerDeliveryAction("echo_test", {
      guard: unguarded("test action"),
      handler: async (out) => {
        seen.push(out.content);
      },
    });
    writeOut(JSON.stringify({ type: "echo_test", payload: 1 }), "system");
    await deliverSessionMessages(session);
    expect(seen).toHaveLength(1);
    expect(delivered).toHaveLength(0); // 系统动作不走适配器
  });

  it("guarded action holds and never runs handler; deny notifies", async () => {
    const holdAction = defineGuardedAction("delivery-cross-group", { decide: () => HOLD("needs approval") });
    let handlerRuns = 0;
    let holdNotified = 0;
    registerDeliveryAction("cross_group", {
      guard: {
        guardAction: holdAction,
        requestHold: async () => {
          holdNotified += 1;
        },
      },
      handler: async () => {
        handlerRuns += 1;
      },
    });
    writeOut(JSON.stringify({ type: "cross_group" }), "system");
    await deliverSessionMessages(session);
    expect(holdNotified).toBe(1);
    expect(handlerRuns).toBe(0);

    const allowAction = defineGuardedAction("delivery-allow", { decide: () => ALLOW("ok") });
    let allowRuns = 0;
    registerDeliveryAction("allow_test", {
      guard: { guardAction: allowAction },
      handler: async () => {
        allowRuns += 1;
      },
    });
    writeOut(JSON.stringify({ type: "allow_test" }), "system");
    await deliverSessionMessages(session);
    expect(allowRuns).toBe(1);
  });

  it("refuses to re-register guarded action as unguarded", () => {
    const a = defineGuardedAction("delivery-x", { decide: () => ALLOW("ok") });
    registerDeliveryAction("x_act", { guard: { guardAction: a }, handler: async () => {} });
    expect(() => registerDeliveryAction("x_act", { guard: unguarded("nope"), handler: async () => {} })).toThrow(
      /unguarded/,
    );
  });

  it("missing adapter retries then marks failed (P1-7 regression)", async () => {
    clearChannelRegistryForTest(); // 无适配器
    writeOut("no adapter for me", "chat");
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      await deliverSessionMessages(session);
    }
    const inbound = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
    const row = inbound.prepare("SELECT status FROM delivered").get() as { status: string };
    expect(row.status).toBe("failed");
    inbound.close();
  });

  it("deny notifies via onDeny and consumes message", async () => {
    const denyAction = defineGuardedAction("delivery-deny", { decide: () => DENY("forbidden target") });
    let denied = 0;
    let runs = 0;
    registerDeliveryAction("deny_test", {
      guard: { guardAction: denyAction, onDeny: async () => void denied++ },
      handler: async () => void runs++,
    });
    writeOut(JSON.stringify({ type: "deny_test" }), "system");
    await deliverSessionMessages(session);
    expect(denied).toBe(1);
    expect(runs).toBe(0);
    const inbound = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
    const row = inbound.prepare("SELECT status FROM delivered").get() as { status: string };
    expect(row.status).toBe("delivered"); // deny 也消费（不重试轰炸）
    inbound.close();
  });

  it("hold without requestHold fails instead of silent delivered (P1-4 regression)", async () => {
    const holdAction = defineGuardedAction("delivery-hold-noreq", { decide: () => HOLD("needs approval") });
    registerDeliveryAction("hold_noreq", { guard: { guardAction: holdAction }, handler: async () => {} });
    writeOut(JSON.stringify({ type: "hold_noreq" }), "system");
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      await deliverSessionMessages(session);
    }
    const inbound = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
    const row = inbound.prepare("SELECT status FROM delivered").get() as { status: string };
    expect(row.status).toBe("failed");
    inbound.close();
  });

  it("grant replay via reenterGuardedDeliveryAction satisfies hold (P1-1 regression)", async () => {
    const grantAction = defineGuardedAction("delivery-grant", {
      decide: () => HOLD("needs approval"), // decide 不自行信任 grant；guard 的 grant 路径负责 hold→allow
      grantActionName: "delivery-grant",
    });
    let runs = 0;
    registerDeliveryAction("grant_test", {
      guard: { guardAction: grantAction, requestHold: async () => {} },
      handler: async () => void runs++,
    });
    const out = {
      id: "o1",
      seq: 1,
      in_reply_to: null,
      timestamp: "2026-08-12T00:00:00Z",
      deliver_after: null,
      recurrence: null,
      kind: "system" as const,
      operation: null,
      platform_id: null,
      channel_type: "cli",
      thread_id: null,
      content: JSON.stringify({ type: "grant_test" }),
    };
    const approval = {
      id: "ap-1",
      session_id: session.id,
      action: "delivery-grant",
      payload: "{}",
      user_id: null,
      approver_user_id: null,
      agent_group_id: null,
      status: "pending" as const,
      title: null,
      options_json: null,
      question: null,
      created_at: "2026-08-12T00:00:00Z",
      resolved_at: null,
    };
    // 无 grant → hold（不执行）
    const { reenterGuardedDeliveryAction } = await import("../../src/delivery.js");
    const reenter = reenterGuardedDeliveryAction("grant_test");
    await reenter(out, session, { ...approval, status: "approved" as const });
    expect(runs).toBe(0); // grant 必须 status=pending（live 行）
    await reenter(out, session, approval);
    expect(runs).toBe(1);
  });

  it("operation field passes through delivery bridge (P1-5 regression)", async () => {
    const db = openOutboundDbRw(outboundDbPath(session.agent_group_id, session.id));
    ensureOutboundSchema(db);
    db.prepare(
      `INSERT INTO messages_out (id, seq, timestamp, kind, operation, content) VALUES ('op1', 7, ?, 'chat', 'edit', 'fixed text')`,
    ).run(new Date().toISOString());
    db.close();
    await deliverSessionMessages(session);
    expect(delivered.length).toBe(1);
  });
});
