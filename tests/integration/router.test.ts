/**
 * router.test.ts —— 路由管线集成测试（Mock 钩子 + 真实会话双 DB）
 *
 * 职责：pattern engage 落库、未接线静默、命令门 deny 直写 outbound、access gate 拒绝审计、
 *       accumulate 策略 trigger=0。
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDb,
  createAgentGroup,
  createMessagingGroup,
  createWiring,
  findSession,
  initTestDb,
  runMigrations,
} from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";
import { inboundDbPath, outboundDbPath, sessionDir } from "../../src/session-manager.js";
import { withInboundDb, openOutboundDbRw } from "../../src/db/session-db.js";
import { resetRouterHooksForTest, routeInbound, setAccessGate, setContainerWaker } from "../../src/router.js";
import { clearChannelRegistryForTest, setActiveAdapterForTest } from "../../src/channels/channel-registry.js";
import { STORE_DIR } from "../../src/config.js";
import type { InboundEvent } from "../../src/channels/adapter.js";
import type { ChannelAdapter } from "../../src/channels/adapter.js";

let agentGroupId: string;
let woken: string[] = [];

function mockAdapter(): ChannelAdapter {
  return {
    name: "mock",
    channelType: "mock",
    supportsThreads: false,
    setup: () => {},
    deliver: async () => undefined,
  };
}

function event(content: string, opts?: Partial<InboundEvent["message"]>): InboundEvent {
  return {
    channelType: "mock",
    platformId: "room-1",
    threadId: null,
    message: {
      id: `evt-${Math.random().toString(36).slice(2, 8)}`,
      kind: "chat",
      content,
      timestamp: new Date().toISOString(),
      ...opts,
    },
  };
}

beforeEach(() => {
  runMigrations(initTestDb(), [migration001]);
  clearChannelRegistryForTest();
  setActiveAdapterForTest(mockAdapter());
  resetRouterHooksForTest();
  woken = [];
  setContainerWaker(async (s) => {
    woken.push(s.id);
    return true;
  });
  agentGroupId = createAgentGroup({ name: "R", folder: `r-${Math.random().toString(36).slice(2, 8)}` }).id;
});

afterEach(() => {
  rmSync(join(STORE_DIR, agentGroupId), { recursive: true, force: true });
  resetRouterHooksForTest();
  clearChannelRegistryForTest();
  closeDb();
});

describe("router pipeline", () => {
  it("pattern engage writes messages_in and wakes container", async () => {
    const mg = createMessagingGroup({ channelType: "mock", platformId: "room-1" });
    createWiring({ messagingGroupId: mg.id, agentGroupId, engageMode: "pattern", engagePattern: "." });
    await routeInbound(event("hello agent"));
    const session = findSession({ agentGroupId, messagingGroupId: mg.id, sessionMode: "shared" });
    expect(session).toBeDefined();
    const rows = withInboundDb(inboundDbPath(agentGroupId, session!.id), (db) =>
      db.prepare("SELECT content, trigger, status FROM messages_in").all(),
    ) as Array<{ content: string; trigger: number; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe("hello agent");
    expect(rows[0]!.trigger).toBe(1);
    expect(woken).toEqual([session!.id]);
  });

  it("unwired channel without mention is silently dropped", async () => {
    createMessagingGroup({ channelType: "mock", platformId: "room-2" });
    await routeInbound({ ...event("chatter"), platformId: "room-2" });
    expect(woken).toEqual([]);
  });

  it("admin command from stranger is denied via outbound system row without waking", async () => {
    const mg = createMessagingGroup({ channelType: "mock", platformId: "room-3" });
    createWiring({ messagingGroupId: mg.id, agentGroupId, engageMode: "pattern", engagePattern: "." });
    await routeInbound({ ...event("/manage-channels"), platformId: "room-3" });
    const session = findSession({ agentGroupId, messagingGroupId: mg.id, sessionMode: "shared" });
    expect(session).toBeDefined();
    const inbound = withInboundDb(inboundDbPath(agentGroupId, session!.id), (db) =>
      db.prepare("SELECT COUNT(*) AS c FROM messages_in").get(),
    ) as { c: number };
    expect(inbound.c).toBe(0); // 不唤醒容器
    const db = openOutboundDbRw(outboundDbPath(agentGroupId, session!.id));
    try {
      const out = db.prepare("SELECT kind, content FROM messages_out").all() as Array<{
        kind: string;
        content: string;
      }>;
      expect(out).toHaveLength(1);
      expect(out[0]!.kind).toBe("system");
      // 阶段 14：拒绝回复随 OC_LOCALE 本地化；断言被拒命令名（三语均含），locale 无关
      expect(out[0]!.content).toContain("/manage-channels");
    } finally {
      db.close();
    }
    expect(woken).toEqual([]);
  });

  it("access gate denial records denied sender and writes nothing", async () => {
    const mg = createMessagingGroup({ channelType: "mock", platformId: "room-4" });
    createWiring({ messagingGroupId: mg.id, agentGroupId, engageMode: "pattern", engagePattern: "." });
    setAccessGate(async () => ({ allow: false, reason: "not a member" }));
    await routeInbound({
      ...event("hi"),
      platformId: "room-4",
      message: { ...event("hi").message, senderId: "mock:intruder" },
    });
    const session = findSession({ agentGroupId, messagingGroupId: mg.id, sessionMode: "shared" });
    expect(session).toBeUndefined();
    expect(woken).toEqual([]);
  });

  it("accumulate policy stores trigger=0 context without waking", async () => {
    const mg = createMessagingGroup({ channelType: "mock", platformId: "room-5" });
    createWiring({
      messagingGroupId: mg.id,
      agentGroupId,
      engageMode: "mention",
      ignoredMessagePolicy: "accumulate",
    });
    await routeInbound({ ...event("context only"), platformId: "room-5" });
    const session = findSession({ agentGroupId, messagingGroupId: mg.id, sessionMode: "shared" });
    expect(session).toBeDefined();
    const rows = withInboundDb(inboundDbPath(agentGroupId, session!.id), (db) =>
      db.prepare("SELECT trigger FROM messages_in").all(),
    ) as Array<{ trigger: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trigger).toBe(0);
    expect(woken).toEqual([]);
  });

  it("inbound attachments are persisted and referenced in content (P1 regression)", async () => {
    const mg = createMessagingGroup({ channelType: "mock", platformId: "room-6" });
    createWiring({ messagingGroupId: mg.id, agentGroupId, engageMode: "pattern", engagePattern: "." });
    const ev = event("with file");
    ev.platformId = "room-6";
    ev.message.attachments = [
      { name: "note.txt", mime: "text/plain", base64: Buffer.from("hello").toString("base64") },
    ];
    await routeInbound(ev);
    const session = findSession({ agentGroupId, messagingGroupId: mg.id, sessionMode: "shared" });
    expect(session).toBeDefined();
    const rows = withInboundDb(inboundDbPath(agentGroupId, session!.id), (db) =>
      db.prepare("SELECT content FROM messages_in").all(),
    ) as Array<{ content: string }>;
    expect(rows[0]!.content).toContain("<attachments>note.txt</attachments>");
    const inboxFile = join(
      sessionDir(agentGroupId, session!.id),
      "inbox",
      `${ev.message.id}:${agentGroupId}`.replace(/[^A-Za-z0-9_-]+/g, "_"),
      "note.txt",
    );
    expect(existsSync(inboxFile)).toBe(true);
  });

  it("accessGate receives agentGroupId (P1 signature regression)", async () => {
    const mg = createMessagingGroup({ channelType: "mock", platformId: "room-7" });
    createWiring({ messagingGroupId: mg.id, agentGroupId, engageMode: "pattern", engagePattern: "." });
    const seen: string[] = [];
    setAccessGate(async (_e, _u, _m, gid) => {
      seen.push(gid);
      return { allow: true };
    });
    await routeInbound({ ...event("hi"), platformId: "room-7" });
    expect(seen).toEqual([agentGroupId]);
  });
});
