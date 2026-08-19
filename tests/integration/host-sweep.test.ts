/**
 * host-sweep.test.ts —— 巡检集成测试（注入 spawner，不真起 Docker）
 *
 * 职责：ack 同步 + 已同步清理；到期唤醒先于崩溃清理；崩溃退避重排/tries≥5 failed/孤儿 ack 删除。
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createAgentGroup, initTestDb, runMigrations } from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";
import { resolveSession } from "../../src/session-manager.js";
import {
  openInboundDb,
  openOutboundDbRw,
  ensureInboundSchema,
  ensureOutboundSchema,
  insertSessionMessage,
} from "../../src/db/session-db.js";
import { inboundDbPath, outboundDbPath } from "../../src/session-manager.js";
import { sweepOnce } from "../../src/host-sweep.js";
import { resetContainerSpawnerForTest, setContainerSpawnerForTest } from "../../src/container-runner.js";
import type { ChildProcess } from "node:child_process";

class FakeProc extends EventEmitter {
  stderr = new EventEmitter();
  stdout = new EventEmitter();
}

beforeEach(() => {
  runMigrations(initTestDb(), [migration001]);
  setContainerSpawnerForTest((_bin, _args) => {
    return new FakeProc() as unknown as ChildProcess;
  });
  // 通过 router 的 waker 钩子无法观测 sweep 唤醒；sweep 直接调 wakeContainer，
  // 这里用 spawner 调用计数间接观测
});

afterEach(() => {
  resetContainerSpawnerForTest();
  closeDb();
});

function openPair(agentGroupId: string, sessionId: string) {
  const inbound = openInboundDb(inboundDbPath(agentGroupId, sessionId));
  ensureInboundSchema(inbound);
  const outbound = openOutboundDbRw(outboundDbPath(agentGroupId, sessionId));
  ensureOutboundSchema(outbound);
  return { inbound, outbound };
}

describe("host sweep", () => {
  it("wakes containers with due messages and syncs acks", async () => {
    const group = createAgentGroup({ name: "HS", folder: `hs-${Math.random().toString(36).slice(2, 8)}` });
    const session = resolveSession({ agentGroupId: group.id, sessionMode: "agent-shared" });
    const { inbound, outbound } = openPair(group.id, session.id);
    insertSessionMessage(inbound, { id: "due-1", kind: "chat", content: "wake me" });
    // 一条已完成 ack 待同步
    insertSessionMessage(inbound, { id: "done-1", kind: "chat", content: "x" });
    outbound
      .prepare("INSERT INTO processing_ack (message_id, status, status_changed) VALUES (?, 'completed', ?)")
      .run("done-1", new Date().toISOString());

    let spawnCount = 0;
    setContainerSpawnerForTest(() => {
      spawnCount += 1;
      return new FakeProc() as unknown as ChildProcess;
    });

    await sweepOnce();
    expect(spawnCount).toBe(1); // due 消息触发唤醒
    const st = inbound.prepare("SELECT status FROM messages_in WHERE id = 'done-1'").get() as { status: string };
    expect(st.status).toBe("completed"); // ack 已同步
    inbound.close();
    outbound.close();
  });

  it("crash cleanup: backoff re-queue, tries>=5 failed, orphan acks deleted (claims source = processing_ack, P0 regression)", async () => {
    const group = createAgentGroup({ name: "HS2", folder: `hs2-${Math.random().toString(36).slice(2, 8)}` });
    const session = resolveSession({ agentGroupId: group.id, sessionMode: "agent-shared" });
    const { inbound, outbound } = openPair(group.id, session.id);
    const now = new Date().toISOString();
    // 生产路径：消息保持 pending，容器崩溃留下 outbound 的 processing ack
    insertSessionMessage(inbound, { id: "stuck-1", kind: "chat", content: "a" });
    insertSessionMessage(inbound, { id: "stuck-5", kind: "chat", content: "b" });
    inbound
      .prepare("UPDATE messages_in SET tries = 5, process_after = '2030-01-01T00:00:00Z' WHERE id = 'stuck-5'")
      .run();
    inbound.prepare("UPDATE messages_in SET process_after = '2030-01-01T00:00:00Z' WHERE id = 'stuck-1'").run();
    outbound
      .prepare("INSERT INTO processing_ack (message_id, status, status_changed) VALUES (?, 'processing', ?)")
      .run("stuck-1", now);
    outbound
      .prepare("INSERT INTO processing_ack (message_id, status, status_changed) VALUES (?, 'processing', ?)")
      .run("stuck-5", now);
    // 孤儿 ack（对应消息已 completed）
    insertSessionMessage(inbound, { id: "ok-1", kind: "chat", content: "c" });
    inbound.prepare("UPDATE messages_in SET status = 'completed' WHERE id = 'ok-1'").run();
    outbound
      .prepare("INSERT INTO processing_ack (message_id, status, status_changed) VALUES (?, 'processing', ?)")
      .run("ok-1", now);

    await sweepOnce();

    const s1 = inbound.prepare("SELECT status, tries, process_after FROM messages_in WHERE id = 'stuck-1'").get() as {
      status: string;
      tries: number;
      process_after: string | null;
    };
    expect(s1.status).toBe("pending");
    expect(s1.tries).toBe(1);
    expect(s1.process_after).not.toBeNull(); // 退避重排
    const s5 = inbound.prepare("SELECT status FROM messages_in WHERE id = 'stuck-5'").get() as { status: string };
    expect(s5.status).toBe("failed"); // tries>=5
    const orphan = outbound.prepare("SELECT COUNT(*) AS c FROM processing_ack WHERE message_id = 'ok-1'").get() as {
      c: number;
    };
    expect(orphan.c).toBe(0); // 孤儿 ack 删除
    inbound.close();
    outbound.close();
  });
});
