/**
 * db/db.test.ts —— 容器侧双 DB 单元测试（bun:test，真实 SQLite temp dir）
 *
 * 职责：奇偶 seq 车道/on_wake 首轮可见/process_after 到期/ack 生命周期/continuation 分键/
 *       stale ack 清理/工具在飞标记/inbound 只读+mmap0。
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏与 import 路径
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  clearStaleProcessingAcks,
  closeSessionDbsForTest,
  getOutboundDb,
  initTestSessionDb,
  openInboundPoll,
  setContainerToolInFlight,
  clearContainerToolInFlight,
  inboundPath,
} from "./connection.ts";
import { INBOUND_SCHEMA, OUTBOUND_SCHEMA } from "./schema.ts";
import { getPendingMessages, markCompleted, markProcessing } from "./messages-in.ts";
import { nextOddSeq, writeMessageOut } from "./messages-out.ts";
import { getContinuation, setContinuation, clearContinuation } from "./session-state.ts";

let dir: string;

function hostWriteInbound(id: string, over: Record<string, unknown> = {}): void {
  const db = new Database(inboundPath());
  db.run(
    `INSERT INTO messages_in (id, seq, kind, timestamp, status, trigger, on_wake, process_after, content)
     VALUES (?, ?, 'chat', '2026-08-12T00:00:00Z', 'pending', ?, ?, ?, ?)`,
    [
      id,
      (over.seq as number) ?? 2,
      (over.trigger as number) ?? 1,
      (over.onWake as number) ?? 0,
      (over.processAfter as string) ?? null,
      (over.content as string) ?? "hi",
    ],
  );
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-ar-"));
  initTestSessionDb(dir, INBOUND_SCHEMA, OUTBOUND_SCHEMA);
});

afterEach(() => {
  closeSessionDbsForTest();
  // Windows 文件锁瞬态：重试删除
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      Bun.sleepSync(50);
    }
  }
});

describe("container db", () => {
  it("outbound seq stays odd", () => {
    const db = getOutboundDb();
    expect(nextOddSeq(db)).toBe(1);
    writeMessageOut({ id: "o1", kind: "chat", content: "a" });
    writeMessageOut({ id: "o2", kind: "chat", content: "b" });
    const seqs = (db.prepare("SELECT seq FROM messages_out ORDER BY seq").all() as Array<{ seq: number }>).map(
      (r) => r.seq,
    );
    expect(seqs).toEqual([1, 3]);
  });

  it("on_wake rows visible only on first poll", () => {
    hostWriteInbound("w1", { onWake: 1, seq: 2 });
    hostWriteInbound("n1", { seq: 4 });
    const first = getPendingMessages({ isFirstPoll: true, nowIso: "2026-08-12T01:00:00Z" });
    expect(first.map((m) => m.id).sort()).toEqual(["n1", "w1"]);
    const second = getPendingMessages({ isFirstPoll: false, nowIso: "2026-08-12T01:00:00Z" });
    expect(second.map((m) => m.id)).toEqual(["n1"]);
  });

  it("process_after gates pickup", () => {
    hostWriteInbound("future", { processAfter: "2026-08-12T05:00:00Z", seq: 2 });
    expect(getPendingMessages({ isFirstPoll: true, nowIso: "2026-08-12T01:00:00Z" })).toEqual([]);
    expect(getPendingMessages({ isFirstPoll: true, nowIso: "2026-08-12T06:00:00Z" })).toHaveLength(1);
  });

  it("ack lifecycle: processing -> completed; stale cleanup", () => {
    hostWriteInbound("a1", { seq: 2 });
    markProcessing(["a1"]);
    let acks = getOutboundDb().prepare("SELECT status FROM processing_ack").all() as Array<{ status: string }>;
    expect(acks[0]?.status).toBe("processing");
    markCompleted(["a1"]);
    acks = getOutboundDb().prepare("SELECT status FROM processing_ack").all() as Array<{ status: string }>;
    expect(acks[0]?.status).toBe("completed");
    markProcessing(["a1"]);
    expect(clearStaleProcessingAcks()).toBe(1);
  });

  it("continuation is per-provider keyed", () => {
    setContinuation("claude", "sess-1");
    setContinuation("openai", "thread-9");
    expect(getContinuation("claude")).toBe("sess-1");
    expect(getContinuation("openai")).toBe("thread-9");
    clearContinuation("claude");
    expect(getContinuation("claude")).toBeNull();
    expect(getContinuation("openai")).toBe("thread-9");
  });

  it("container_state tool in-flight mark/clear", () => {
    setContainerToolInFlight("Bash", 60000);
    type ToolState = { current_tool: string | null; tool_declared_timeout_ms: number | null };
    let st = getOutboundDb().prepare("SELECT current_tool, tool_declared_timeout_ms FROM container_state WHERE id=1").get() as ToolState;
    expect(st.current_tool).toBe("Bash");
    expect(st.tool_declared_timeout_ms).toBe(60000);
    clearContainerToolInFlight();
    st = getOutboundDb().prepare("SELECT current_tool FROM container_state WHERE id=1").get() as ToolState;
    expect(st.current_tool).toBeNull();
  });

  it("inbound poll connection is readonly + mmap_size=0", () => {
    const db = openInboundPoll();
    const mmap = db.prepare("PRAGMA mmap_size").get() as { mmap_size: number };
    expect(mmap.mmap_size).toBe(0);
    expect(() => db.run("INSERT INTO messages_in (id, kind, timestamp, content) VALUES ('x','chat','t','c')")).toThrow();
    db.close();
  });
});
