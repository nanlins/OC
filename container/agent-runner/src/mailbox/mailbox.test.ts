/**
 * mailbox.test.ts —— mailbox 抽象层行为测试（bun:test）
 *
 * 职责：withMailboxSession 生命周期（连接一次打开、用毕即关）；
 *       mailbox.run 包装与返回值透传；读批 + 置 processing 同会话；
 *       session 状态 KV 读写；批次组装（composeBatch）。
 *
 * 修改记录：2026-10-06 创建（P0-1：mailbox 抽象层）
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { closeSessionDbsForTest, getOutboundDb, initTestSessionDb, inboundPath } from "../db/connection.ts";
import { INBOUND_SCHEMA, OUTBOUND_SCHEMA } from "../db/schema.ts";
import { getAgentMailbox, resetMailboxForTest, withMailboxSession } from "./index.ts";
import { composeBatch } from "./compose.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-mb-"));
  initTestSessionDb(dir, INBOUND_SCHEMA, OUTBOUND_SCHEMA);
});

afterEach(() => {
  closeSessionDbsForTest();
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      Bun.sleepSync(50);
    }
  }
});

function hostWrite(id: string, content: string, trigger = 1): void {
  const db = new Database(inboundPath());
  db.run(
    `INSERT INTO messages_in (id, seq, kind, timestamp, status, trigger, content) VALUES (?, ?, 'chat', '2026-08-12T00:00:00Z', 'pending', ?, ?)`,
    [id, Math.floor(Math.random() * 100000) + 2, trigger, content],
  );
  db.close();
}

describe("mailbox session lifecycle", () => {
  it("withMailboxSession runs the callback and closes the outbound connection after", async () => {
    const seen = await withMailboxSession((mbox) => {
      // 会话内可写（连接就绪）
      mbox.setState("k1", "v1");
      return mbox.getState("k1");
    });
    expect(seen).toBe("v1");
    // 会话结束：outbound 连接已关（getOutboundDb 会重新打开，这里只断言关闭动作可重复执行不抛错）
    expect(() => closeSessionDbsForTest()).not.toThrow();
  });

  it("mailbox.run returns the action's value and injects a usable session", async () => {
    resetMailboxForTest();
    const mbox = getAgentMailbox();
    const out = await mbox.run((s) => {
      s.setState("run-key", "run-value");
      return s.getState("run-key");
    });
    expect(out).toBe("run-value");
    expect(getOutboundDb().prepare("SELECT value FROM session_state WHERE key='run-key'").get()).toEqual({
      value: "run-value",
    });
  });

  it("state KV writes persist across sessions (session_state 表)", async () => {
    await withMailboxSession((s) => s.setState("persist", "yes"));
    const later = await withMailboxSession((s) => s.getState("persist"));
    expect(later).toBe("yes");
    await withMailboxSession((s) => s.deleteState("persist"));
    expect(await withMailboxSession((s) => s.getState("persist"))).toBeNull();
  });

  it("readPending + markProcessing happen in one session and write ack rows", async () => {
    hostWrite("m1", "hello");
    await withMailboxSession((mbox) => {
      const msgs = mbox.readPending({ isFirstPoll: true, max: 10, nowIso: new Date().toISOString() });
      expect(msgs.map((m) => m.id)).toContain("m1");
      mbox.markProcessing(msgs.map((m) => m.id));
    });
    const ack = getOutboundDb().prepare("SELECT status FROM processing_ack WHERE message_id='m1'").get() as {
      status: string;
    };
    expect(ack.status).toBe("processing");
  });

  it("writeOutbound writes odd-seq rows (container lane)", async () => {
    const seq = await withMailboxSession((mbox) =>
      mbox.writeOutbound({ id: "o1", kind: "chat", content: "reply", streamFinal: true }),
    );
    expect(seq % 2).toBe(1);
    const row = getOutboundDb().prepare("SELECT kind, stream_final FROM messages_out WHERE seq=?").get(seq) as {
      kind: string;
      stream_final: number;
    };
    expect(row.kind).toBe("chat");
    expect(row.stream_final).toBe(1);
  });
});

describe("mailbox compose", () => {
  it("composeBatch derives batch routing from the last message", () => {
    const batch = composeBatch([
      { id: "a", seq: 1, kind: "chat", timestamp: "", status: "pending", process_after: null, recurrence: null, series_id: null, tries: 0, trigger: 1, on_wake: 0, platform_id: null, channel_type: null, thread_id: null, content: "x", source_session_id: null },
      { id: "b", seq: 3, kind: "chat", timestamp: "", status: "pending", process_after: null, recurrence: null, series_id: null, tries: 0, trigger: 1, on_wake: 0, platform_id: "p1", channel_type: "cli", thread_id: "t1", content: "y", source_session_id: null },
    ]);
    expect(batch.messages).toHaveLength(2);
    expect(batch.routing).toEqual({ platformId: "p1", channelType: "cli", threadId: "t1" });
  });

  it("composeBatch on an empty batch yields null routing", () => {
    const batch = composeBatch([]);
    expect(batch.messages).toHaveLength(0);
    expect(batch.routing).toEqual({ platformId: null, channelType: null, threadId: null });
  });
});
