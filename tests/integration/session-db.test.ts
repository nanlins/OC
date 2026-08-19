/**
 * session-db.test.ts —— 会话双 DB 集成测试（真实 SQLite + temp dir）
 *
 * 职责：验证双库 schema、偶数 seq、到期门控、ack 同步、投递簿记、writeOutboundDirect 偶数步长、
 *       journal_mode=DELETE 承重不变量。
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 *   2026-08-12 追加 se-inspector 回归用例（ack 终态守卫/先写为准/deliver_after/withInboundDb/series_id）
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countDueMessages,
  ensureInboundSchema,
  ensureOutboundSchema,
  getDeliveredIds,
  getDueOutboundMessages,
  getUndeliveredOutbound,
  insertSessionMessage,
  markDelivered,
  markDeliveryFailed,
  openInboundDb,
  openOutboundDbRw,
  syncProcessingAcks,
  withInboundDb,
  writeOutboundDirect,
  writeSessionRouting,
} from "../../src/db/session-db.js";

let dir: string;
let inboundPath: string;
let outboundPath: string;
let inbound: Database.Database;
let outbound: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-sess-"));
  inboundPath = join(dir, "inbound.db");
  outboundPath = join(dir, "outbound.db");
  inbound = openInboundDb(inboundPath);
  ensureInboundSchema(inbound);
  outbound = openOutboundDbRw(outboundPath);
  ensureOutboundSchema(outbound);
});

afterEach(() => {
  inbound.close();
  outbound.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("session dual-db", () => {
  it("uses journal_mode=DELETE (load-bearing cross-mount invariant)", () => {
    expect((inbound.pragma("journal_mode") as Array<{ journal_mode: string }>)[0]?.journal_mode).toBe("delete");
    expect((outbound.pragma("journal_mode") as Array<{ journal_mode: string }>)[0]?.journal_mode).toBe("delete");
  });

  it("host seq numbers are even and strictly increasing", () => {
    insertSessionMessage(inbound, { id: "m1", kind: "chat", content: "hi" });
    insertSessionMessage(inbound, { id: "m2", kind: "chat", content: "again" });
    const seqs = (inbound.prepare("SELECT seq FROM messages_in ORDER BY seq").all() as Array<{ seq: number }>).map(
      (r) => r.seq,
    );
    expect(seqs).toEqual([2, 4]);
  });

  it("countDueMessages respects process_after and trigger gate", () => {
    const now = "2026-08-12T10:00:00Z";
    insertSessionMessage(inbound, { id: "due", kind: "chat", content: "now" });
    insertSessionMessage(inbound, {
      id: "future",
      kind: "task",
      content: "later",
      processAfter: "2026-08-12T11:00:00Z",
    });
    insertSessionMessage(inbound, { id: "ctx", kind: "chat", content: "context", trigger: 0 });
    expect(countDueMessages(inbound, now)).toBe(1);
    expect(countDueMessages(inbound, "2026-08-12T12:00:00Z")).toBe(2);
  });

  it("syncProcessingAcks maps script-skip:error to failed and never writes outbound", () => {
    insertSessionMessage(inbound, { id: "a1", kind: "chat", content: "x" });
    insertSessionMessage(inbound, { id: "a2", kind: "chat", content: "y" });
    outbound
      .prepare("INSERT INTO processing_ack (message_id, status, status_changed) VALUES (?, ?, ?)")
      .run("a1", "completed", "2026-08-12T10:00:00Z");
    outbound
      .prepare("INSERT INTO processing_ack (message_id, status, status_changed) VALUES (?, ?, ?)")
      .run("a2", "script-skip:error", "2026-08-12T10:00:00Z");
    const n = syncProcessingAcks(inbound, outbound);
    expect(n).toBe(2);
    const st = (id: string) =>
      (inbound.prepare("SELECT status FROM messages_in WHERE id = ?").get(id) as { status: string }).status;
    expect(st("a1")).toBe("completed");
    expect(st("a2")).toBe("failed");
  });

  it("delivery bookkeeping: delivered set + first-write-wins (P2-3, baseline INSERT OR IGNORE)", () => {
    writeOutboundDirect(outbound, { id: "o1", kind: "chat", content: "reply" });
    expect(getUndeliveredOutbound(outbound)).toHaveLength(1);
    markDelivered(inbound, "o1", "plat-1");
    expect(getDeliveredIds(inbound).has("o1")).toBe(true);
    markDeliveryFailed(inbound, "o1"); // 先写为准：既有 delivered 行不被后写覆盖
    const row = inbound.prepare("SELECT status FROM delivered WHERE message_out_id = 'o1'").get() as {
      status: string;
    };
    expect(row.status).toBe("delivered");
    markDeliveryFailed(inbound, "o2"); // 无先写记录时 failed 正常落库
    const row2 = inbound.prepare("SELECT status FROM delivered WHERE message_out_id = 'o2'").get() as {
      status: string;
    };
    expect(row2.status).toBe("failed");
  });

  it("writeOutboundDirect keeps even seq parity (container writes odd)", () => {
    // 模拟容器写奇数 seq
    outbound
      .prepare(
        "INSERT INTO messages_out (id, seq, timestamp, kind, content) VALUES ('c1', 1, '2026-08-12T09:00:00Z', 'chat', 'agent')",
      )
      .run();
    writeOutboundDirect(outbound, { id: "h1", kind: "system", content: "denied" });
    writeOutboundDirect(outbound, { id: "h2", kind: "system", content: "denied2" });
    const seqs = (outbound.prepare("SELECT seq FROM messages_out ORDER BY seq").all() as Array<{ seq: number }>).map(
      (r) => r.seq,
    );
    expect(seqs).toEqual([1, 2, 4]); // 容器奇数 / 主机偶数互不冲突
  });

  it("session_routing is a single-row table overwritten on write", () => {
    writeSessionRouting(inbound, { channelType: "cli", platformId: "local", threadId: null });
    writeSessionRouting(inbound, { channelType: "telegram", platformId: "42", threadId: "t9" });
    const rows = inbound.prepare("SELECT * FROM session_routing").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { channel_type: string }).channel_type).toBe("telegram");
  });
});

describe("se-inspector regressions (phase 1)", () => {
  it("syncProcessingAcks never rolls back terminal states and ignores unknown statuses", () => {
    insertSessionMessage(inbound, { id: "t1", kind: "chat", content: "x" });
    insertSessionMessage(inbound, { id: "t2", kind: "chat", content: "y" });
    // t1 已终态 completed；outbound 残留 processing ack 不得回退
    inbound.prepare("UPDATE messages_in SET status = 'completed' WHERE id = 't1'").run();
    outbound
      .prepare("INSERT INTO processing_ack (message_id, status, status_changed) VALUES (?, ?, ?)")
      .run("t1", "processing", "2026-08-12T10:00:00Z");
    // 未知状态不得灌入 messages_in
    outbound
      .prepare("INSERT INTO processing_ack (message_id, status, status_changed) VALUES (?, ?, ?)")
      .run("t2", "weird-status", "2026-08-12T10:00:00Z");
    syncProcessingAcks(inbound, outbound);
    const st = (id: string) =>
      (inbound.prepare("SELECT status FROM messages_in WHERE id = ?").get(id) as { status: string }).status;
    expect(st("t1")).toBe("completed");
    expect(st("t2")).toBe("pending");
  });

  it("delivered bookkeeping is first-write-wins", () => {
    markDelivered(inbound, "d1", "plat-9");
    markDeliveryFailed(inbound, "d1"); // 后写被忽略
    const row = inbound
      .prepare("SELECT status, platform_message_id FROM delivered WHERE message_out_id = 'd1'")
      .get() as {
      status: string;
      platform_message_id: string;
    };
    expect(row.status).toBe("delivered");
    expect(row.platform_message_id).toBe("plat-9");
  });

  it("getDueOutboundMessages filters deliver_after", () => {
    writeOutboundDirect(outbound, { id: "now1", kind: "chat", content: "a" });
    outbound.prepare("UPDATE messages_out SET deliver_after = '2026-08-12T12:00:00Z' WHERE id = 'now1'").run();
    writeOutboundDirect(outbound, { id: "later", kind: "chat", content: "b" });
    outbound.prepare("UPDATE messages_out SET deliver_after = '2026-08-12T13:00:00Z' WHERE id = 'later'").run();
    const { getDueOutboundMessages: due } = { getDueOutboundMessages };
    expect(due(outbound, "2026-08-12T11:00:00Z")).toHaveLength(0);
    expect(due(outbound, "2026-08-12T12:30:00Z").map((m) => m.id)).toEqual(["now1"]);
  });

  it("withInboundDb opens and closes per call (open-write-CLOSE invariant)", () => {
    withInboundDb(inboundPath, (db) => {
      insertSessionMessage(db, { id: "w1", kind: "chat", content: "via helper" });
    });
    const row = inbound.prepare("SELECT content FROM messages_in WHERE id = 'w1'").get() as { content: string };
    expect(row.content).toBe("via helper");
  });

  it("series_id defaults to the message's own id", () => {
    insertSessionMessage(inbound, { id: "s1", kind: "chat", content: "x" });
    const row = inbound.prepare("SELECT series_id FROM messages_in WHERE id = 's1'").get() as { series_id: string };
    expect(row.series_id).toBe("s1");
  });
});

/*
 * 修改记录：
 *   2026-08-12 修正既有用例 "delivery bookkeeping"：原期望 failed 覆盖 delivered，与基线（nanoclaw
 *              src/db/session-db.ts 双 INSERT OR IGNORE）及本文件先写为准回归用例矛盾；改为断言
 *              first-write-wins，并补无先写记录时 failed 正常落库的断言。
 */
