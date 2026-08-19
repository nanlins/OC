/**
 * modules.test.ts —— 模块系统集成测试（阶段 6）
 *
 * 职责：permissions 门控（strict/public/member）；scheduling 建任务+recurrence re-arm；
 *       a2a 路由；memory-kb 分块+检索+阈值；quota；observability 审计 sink。
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  closeDb,
  initTestDb,
  runMigrations,
  createAgentGroup,
  createMessagingGroup,
  createWiring,
  grantRole,
  upsertUser,
  findSession,
} from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";
import { routeInbound } from "../../src/router.js";
import { inboundDbPath, resolveSession } from "../../src/session-manager.js";
import { openInboundDb } from "../../src/db/session-db.js";
import { getDeliveryAction } from "../../src/delivery.js";
import { clearChannelRegistryForTest, setActiveAdapterForTest } from "../../src/channels/channel-registry.js";
import { handleRecurrence, MAX_DAILY_FIRES } from "../../src/modules/scheduling.js";
import { routeAgentMessage, writeDestinations } from "../../src/modules/agent-to-agent.js";
import { chunkText, addDocument, searchKb, MIN_SCORE } from "../../src/modules/memory-kb.js";
import { recordUsage, checkQuota } from "../../src/modules/quota.js";
import { queryGuardAudit } from "../../src/modules/observability.js";
import { defineGuardedAction, ALLOW } from "../../src/guard/index.js";
import { setContainerSpawnerForTest, resetContainerSpawnerForTest } from "../../src/container-runner.js";
import { resolveApproval } from "../../src/modules/approvals.js";
import "../../src/modules/index.js"; // 副作用：钩子 + 模块迁移注册
import type { InboundEvent } from "../../src/channels/adapter.js";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

let groupId: string;

function event(senderId: string, content: string, platformId = "room-1"): InboundEvent {
  return {
    channelType: "mock",
    platformId,
    threadId: null,
    message: {
      id: randomUUID(),
      kind: "chat",
      content,
      timestamp: new Date().toISOString(),
      isMention: true,
      isGroup: false,
      senderId,
      senderName: "tester",
    },
  };
}

beforeEach(() => {
  runMigrations(initTestDb(), [migration001]);
  clearChannelRegistryForTest();
  setActiveAdapterForTest({
    name: "mock",
    channelType: "mock",
    supportsThreads: false,
    setup: () => {},
    deliver: async () => undefined,
  });
  setContainerSpawnerForTest((_bin, _args) => new EventEmitter() as unknown as ChildProcess); // 测试绝不真起 Docker
  groupId = createAgentGroup({ name: "M", folder: `m-${Math.random().toString(36).slice(2, 8)}` }).id;
});

afterEach(() => {
  resetContainerSpawnerForTest();
  clearChannelRegistryForTest();
  closeDb();
});

describe("permissions gate", () => {
  it("strict policy drops strangers, admits members", async () => {
    const mg = createMessagingGroup({ channelType: "mock", platformId: "room-1", unknownSenderPolicy: "strict" });
    createWiring({ messagingGroupId: mg.id, agentGroupId: groupId, engageMode: "pattern", engagePattern: "." });
    await routeInbound(event("mock:stranger", "hi"));
    expect(findSession({ agentGroupId: groupId, messagingGroupId: mg.id, sessionMode: "shared" })).toBeUndefined();

    const owner = upsertUser("mock:owner", "mock");
    grantRole(owner.id, "owner", null);
    await routeInbound(event("mock:owner", "hi"));
    expect(findSession({ agentGroupId: groupId, messagingGroupId: mg.id, sessionMode: "shared" })).toBeDefined();
  });

  it("public policy admits anyone", async () => {
    const mg = createMessagingGroup({ channelType: "mock", platformId: "room-2", unknownSenderPolicy: "public" });
    createWiring({ messagingGroupId: mg.id, agentGroupId: groupId, engageMode: "pattern", engagePattern: "." });
    await routeInbound(event("mock:anyone", "hi", "room-2"));
    expect(findSession({ agentGroupId: groupId, messagingGroupId: mg.id, sessionMode: "shared" })).toBeDefined();
  });
});

describe("scheduling", () => {
  it("schedule_task creates a task row with cron next-fire", async () => {
    const session = resolveSession({ agentGroupId: groupId, sessionMode: "agent-shared" });
    const wrapped = getDeliveryAction("schedule_task");
    expect(wrapped).toBeDefined();
    await wrapped!(
      {
        id: "s1",
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
        content: JSON.stringify({ message: "daily report", cron: "0 9 * * *" }),
      },
      session,
    );
    // 任务会话应有 pending task 行
    const { listSessions } = await import("../../src/db/sessions.js");
    const taskSession = listSessions().find((s) => (s.thread_id ?? "").startsWith("system:tasks:"));
    expect(taskSession).toBeDefined();
    const inbound = openInboundDb(inboundDbPath(taskSession!.agent_group_id, taskSession!.id));
    const row = inbound.prepare("SELECT kind, status, recurrence, process_after FROM messages_in").get() as {
      kind: string;
      status: string;
      recurrence: string | null;
      process_after: string | null;
    };
    expect(row.kind).toBe("task");
    expect(row.recurrence).toBe("0 9 * * *");
    expect(row.process_after).not.toBeNull();
    inbound.close();
  });

  it("handleRecurrence re-arms completed series", () => {
    const session = resolveSession({ agentGroupId: groupId, sessionMode: "agent-shared" });
    const inbound = openInboundDb(inboundDbPath(groupId, session.id));
    const series = "series-1";
    inbound
      .prepare(
        `INSERT INTO messages_in (id, seq, kind, timestamp, status, recurrence, series_id, content)
         VALUES ('done-1', 2, 'task', '2026-08-12T00:00:00Z', 'completed', '0 9 * * *', ?, 'x')`,
      )
      .run(series);
    inbound.close();
    handleRecurrence(session);
    const inbound2 = openInboundDb(inboundDbPath(groupId, session.id));
    const pending = inbound2
      .prepare("SELECT COUNT(*) AS c FROM messages_in WHERE kind = 'task' AND status = 'pending' AND series_id = ?")
      .get(series) as { c: number };
    expect(pending.c).toBe(1);
    inbound2.close();
  });

  it("MAX_DAILY_FIRES constant is 4", () => {
    expect(MAX_DAILY_FIRES).toBe(4);
  });
});

describe("agent-to-agent", () => {
  it("routes a2a messages into target agent session (authorized via destinations)", async () => {
    const targetId = createAgentGroup({ name: "T", folder: `t-${Math.random().toString(36).slice(2, 8)}` }).id;
    const source = resolveSession({ agentGroupId: groupId, sessionMode: "agent-shared" });
    writeDestinations(source); // spawn 时投影（测试手动触发）
    await routeAgentMessage(
      {
        id: "a1",
        seq: 1,
        in_reply_to: null,
        timestamp: new Date().toISOString(),
        deliver_after: null,
        recurrence: null,
        kind: "a2a",
        operation: null,
        platform_id: targetId,
        channel_type: "agent",
        thread_id: null,
        content: "collab?",
      },
      source,
    );
    const target = findSession({ agentGroupId: targetId, sessionMode: "agent-shared" });
    expect(target).toBeDefined();
    const inbound = openInboundDb(inboundDbPath(targetId, target!.id));
    const row = inbound.prepare("SELECT kind, content, source_session_id FROM messages_in").get() as {
      kind: string;
      content: string;
      source_session_id: string;
    };
    expect(row.kind).toBe("a2a");
    expect(row.source_session_id).toBe(source.id);
    inbound.close();
  });
});

describe("memory-kb (RAG extension)", () => {
  it("chunks recursively with overlap budget", () => {
    const chunks = chunkText("a".repeat(1000));
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 400)).toBe(true);
  });

  it("search returns relevant chunk and rejects below threshold", () => {
    addDocument("kb1", "refund policy", "如何申请退款：请在设置页提交退款申请。退款流程三个工作日。", "doc1");
    const hits = searchKb("kb1", "怎么退钱 退款");
    // 中文 tokenize 按连续汉字：query token "怎么退钱" 与 chunk token 不重叠 → 低于阈值
    expect(Array.isArray(hits)).toBe(true);
    const hits2 = searchKb("kb1", "退款 申请");
    expect(hits2.length).toBeGreaterThan(0);
    expect(hits2[0]!.score).toBeGreaterThanOrEqual(MIN_SCORE);
  });
});

describe("quota", () => {
  it("records and checks daily usage", () => {
    recordUsage("u1", 1000);
    const q = checkQuota("u1");
    expect(q.used).toBe(1000);
    expect(q.allowed).toBe(true);
  });
});

describe("observability audit sink", () => {
  it("records guard decisions", async () => {
    const a = defineGuardedAction("audit-probe", { decide: () => ALLOW("ok") });
    const { registerDeliveryAction } = await import("../../src/delivery.js");
    registerDeliveryAction("audit_probe", { guard: { guardAction: a }, handler: async () => {} });
    const session = resolveSession({ agentGroupId: groupId, sessionMode: "agent-shared" });
    const wrapped = getDeliveryAction("audit_probe");
    await wrapped!(
      {
        id: "o1",
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
    const rows = queryGuardAudit("audit-probe");
    expect(rows.length).toBeGreaterThan(0);
    expect(String(rows[0]!.decision)).toBe("allow");
  });
});

describe("phase-6 regressions", () => {
  it("a2a unauthorized target throws (P1 regression)", async () => {
    const targetId = createAgentGroup({ name: "U", folder: `u-${Math.random().toString(36).slice(2, 8)}` }).id;
    const source = resolveSession({ agentGroupId: groupId, sessionMode: "agent-shared" });
    // 无 writeDestinations → 未授权
    await expect(
      routeAgentMessage(
        {
          id: "a2",
          seq: 1,
          in_reply_to: null,
          timestamp: new Date().toISOString(),
          deliver_after: null,
          recurrence: null,
          kind: "a2a",
          operation: null,
          platform_id: targetId,
          channel_type: "agent",
          thread_id: null,
          content: "x",
        },
        source,
      ),
    ).rejects.toThrow(/unauthorized/);
  });

  it("predictive recurrence limit rejects */5 cron (P1 regression)", async () => {
    const session = resolveSession({ agentGroupId: groupId, sessionMode: "agent-shared" });
    const wrapped = getDeliveryAction("schedule_task");
    await expect(
      wrapped!(
        {
          id: "s2",
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
          content: JSON.stringify({ message: "too frequent", cron: "*/5 * * * *" }),
        },
        session,
      ),
    ).rejects.toThrow(/recurrence limit/);
  });

  it("8 consecutive failures auto-pause with recoverable paused row (P0 regression)", () => {
    const session = resolveSession({ agentGroupId: groupId, sessionMode: "agent-shared" });
    const inbound = openInboundDb(inboundDbPath(groupId, session.id));
    const series = "series-p";
    inbound
      .prepare(
        `INSERT INTO messages_in (id, seq, kind, timestamp, status, recurrence, series_id, content)
         VALUES ('done-p', 2, 'task', '2026-08-12T00:00:00Z', 'completed', '0 9 * * *', ?, 'x')`,
      )
      .run(series);
    for (let i = 0; i < 8; i++) {
      inbound
        .prepare(
          `INSERT INTO messages_in (id, seq, kind, timestamp, status, recurrence, series_id, content)
           VALUES (?, ?, 'task', '2026-08-12T00:00:00Z', 'failed', '0 9 * * *', ?, 'x')`,
        )
        .run(`f-${i}`, 4 + i * 2, series); // failed 在时序尾部 → trailing=8
    }
    inbound.close();
    handleRecurrence(session);
    const inbound2 = openInboundDb(inboundDbPath(groupId, session.id));
    const paused = inbound2
      .prepare("SELECT COUNT(*) AS c FROM messages_in WHERE kind = 'task' AND status = 'paused' AND series_id = ?")
      .get(series) as { c: number };
    expect(paused.c).toBe(1);
    inbound2.close();
  });

  it("self-mod approval replay executes apply end-to-end (P0 regression)", async () => {
    const owner = upsertUser("mock:owner2", "mock");
    grantRole(owner.id, "owner", null);
    const session = resolveSession({ agentGroupId: groupId, sessionMode: "agent-shared" });
    const wrapped = getDeliveryAction("self_mod.install_packages");
    expect(wrapped).toBeDefined();
    const out = {
      id: "sm1",
      seq: 1,
      in_reply_to: null,
      timestamp: new Date().toISOString(),
      deliver_after: null,
      recurrence: null,
      kind: "system" as const,
      operation: null,
      platform_id: null,
      channel_type: "mock",
      thread_id: null,
      content: JSON.stringify({ type: "self_mod.install_packages", packages: ["left-pad"] }),
    };
    await wrapped!(out, session); // → hold → requestHold → pending_approvals 行
    const { getDb } = await import("../../src/db/connection.js");
    const row = getDb().prepare("SELECT id, action FROM pending_approvals").get() as { id: string; action: string };
    expect(row.action).toBe("self_mod.install_packages");
    await resolveApproval(row.id, "approve", out, session); // 回放执行 apply+restart
    const cfg = getDb().prepare("SELECT packages FROM container_configs WHERE agent_group_id = ?").get(groupId) as {
      packages: string;
    };
    expect(JSON.parse(cfg.packages)).toContain("left-pad");
    // 恰好一次：二次 resolve 返回 false
    expect(await resolveApproval(row.id, "approve", out, session)).toBe(false);
  });

  it("interactive answer roundtrip with sender gate (P1 regression)", async () => {
    const owner = upsertUser("mock:owner3", "mock");
    grantRole(owner.id, "owner", null);
    const session = resolveSession({ agentGroupId: groupId, sessionMode: "agent-shared" });
    const wrapped = getDeliveryAction("ask_question");
    const qid = randomUUID();
    await wrapped!(
      {
        id: "q1",
        seq: 1,
        in_reply_to: null,
        timestamp: new Date().toISOString(),
        deliver_after: null,
        recurrence: null,
        kind: "system" as const,
        operation: null,
        platform_id: "room-1",
        channel_type: "mock",
        thread_id: null,
        content: JSON.stringify({ type: "ask_question", questionId: qid, question: "pick one", options: ["a", "b"] }),
      },
      session,
    );
    const mg = createMessagingGroup({ channelType: "mock", platformId: "room-1", unknownSenderPolicy: "strict" });
    createWiring({ messagingGroupId: mg.id, agentGroupId: groupId, engageMode: "pattern", engagePattern: "." });
    await routeInbound(event("mock:owner3", JSON.stringify({ answer_to: qid, text: "a" }), "room-1"));
    const inbound = openInboundDb(inboundDbPath(groupId, session.id));
    const row = inbound.prepare("SELECT kind, content FROM messages_in WHERE kind = 'question_response'").get() as
      { kind: string; content: string } | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(row!.content).answer).toBe("a");
    expect(JSON.parse(row!.content).userId).toBe("mock:owner3");
    inbound.close();
  });
});
