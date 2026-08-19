/**
 * poll-loop.test.ts —— 轮询循环端到端测试（MockProvider，bun:test）
 *
 * 职责：消息进→响应出→ack completed；累积门控（trigger=0 不唤醒）；corruption exit(75)。
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏与语法错误
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { closeSessionDbsForTest, getOutboundDb, initTestSessionDb, inboundPath } from "./db/connection.ts";
import { INBOUND_SCHEMA, OUTBOUND_SCHEMA } from "./db/schema.ts";
import { runPollLoop, isCorruptionError } from "./poll-loop.ts";
import { MockProvider } from "./providers/mock.ts";

let dir: string;

function hostWrite(id: string, content: string, trigger = 1): void {
  const db = new Database(inboundPath());
  db.run(
    `INSERT INTO messages_in (id, seq, kind, timestamp, status, trigger, content) VALUES (?, ?, 'chat', '2026-08-12T00:00:00Z', 'pending', ?, ?)`,
    [id, Math.floor(Math.random() * 100000) + 2, trigger, content],
  );
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-pl-"));
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

async function runUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const controller = new AbortController();
  const loop = runPollLoop({
    provider: new MockProvider(),
    timezone: "UTC",
    assistantName: null,
    maxMessages: 10,
    signal: controller.signal,
    sleepMs: { idle: 50, hot: 25 },
  });
  const waiter = (async () => {
    while (!predicate()) await new Promise((r) => setTimeout(r, 25));
  })();
  await Promise.race([waiter, new Promise((r) => setTimeout(r, timeoutMs))]);
  controller.abort();
  await loop.catch(() => {});
}

describe("poll loop", () => {
  it("message in -> echo out -> ack completed", async () => {
    hostWrite("m1", "hello agent");
    await runUntil(() => {
      const out = getOutboundDb().prepare("SELECT content FROM messages_out").all() as Array<{ content: string }>;
      return out.some((r) => r.content.includes("echo"));
    });
    const out = getOutboundDb().prepare("SELECT content FROM messages_out").all() as Array<{ content: string }>;
    expect(out.some((r) => r.content.includes("hello agent"))).toBe(true);
    const ack = getOutboundDb().prepare("SELECT status FROM processing_ack WHERE message_id='m1'").get() as {
      status: string;
    };
    expect(ack.status).toBe("completed");
  });

  it("trigger=0 context-only batches do not wake the provider", async () => {
    hostWrite("ctx1", "context only", 0);
    const controller = new AbortController();
    const loop = runPollLoop({
      provider: new MockProvider(),
      timezone: "UTC",
      assistantName: null,
      maxMessages: 10,
      signal: controller.signal,
      sleepMs: { idle: 25, hot: 25 },
    });
    await new Promise((r) => setTimeout(r, 400));
    controller.abort();
    await loop.catch(() => {});
    const out = getOutboundDb().prepare("SELECT COUNT(*) AS c FROM messages_out").get() as { c: number };
    expect(out.c).toBe(0);
    const st = new Database(inboundPath()).prepare("SELECT status FROM messages_in WHERE id='ctx1'").get() as {
      status: string;
    };
    expect(st.status).toBe("pending");
  });

  it("isCorruptionError matches sqlite corruption signatures", () => {
    expect(isCorruptionError(new Error("SQLITE_CORRUPT: bad page"))).toBe(true);
    expect(isCorruptionError(new Error("database disk image is malformed"))).toBe(true);
    expect(isCorruptionError(new Error("no such table"))).toBe(false);
  });

  it("corruption streak triggers exit(75) via injected hook", async () => {
    const state: { code: number | null } = { code: null };
    rmSync(join(dir, "inbound.db"));
    writeFileSync(join(dir, "inbound.db"), "not a database file at all");
    const controller = new AbortController();
    const loop = runPollLoop({
      provider: new MockProvider(),
      timezone: "UTC",
      assistantName: null,
      maxMessages: 10,
      signal: controller.signal,
      onCorruptionExit: (code) => {
        state.code = code;
        controller.abort();
      },
      sleepMs: { idle: 5, hot: 5 },
    });
    await Promise.race([loop.catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
    expect(state.code).toBe(75);
  });

  it("streaming provider writes live message + throttled edits (fix-plan streaming delivery)", async () => {
    const streamingProvider = {
      name: "streamtest",
      push: () => {},
      getContinuationId: () => null,
      async *query(): AsyncIterable<{ type: string; message?: string; text?: string }> {
        yield { type: "activity" };
        yield { type: "progress", message: "Hel" };
        yield { type: "progress", message: "lo " };
        yield { type: "progress", message: "world" };
        yield { type: "result", text: "Hello world" };
      },
    };
    hostWrite("s1", "stream please");
    const controller = new AbortController();
    const loop = runPollLoop({
      provider: streamingProvider as never,
      timezone: "UTC",
      assistantName: null,
      maxMessages: 10,
      signal: controller.signal,
      sleepMs: { idle: 25, hot: 25 },
      editThrottleMs: 0, // 每个增量都写 edit，便于断言
    });
    const waiter = (async () => {
      while (
        ((getOutboundDb().prepare("SELECT COUNT(*) AS c FROM messages_out").get() as { c: number }).c) < 3
      ) {
        await new Promise((r) => setTimeout(r, 25));
      }
    })();
    await Promise.race([waiter, new Promise((r) => setTimeout(r, 5000))]);
    controller.abort();
    await loop.catch(() => {});

    const rows = getOutboundDb()
      .prepare("SELECT id, operation, in_reply_to, content FROM messages_out ORDER BY seq")
      .all() as Array<{ id: string; operation: string | null; in_reply_to: string | null; content: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const live = rows.find((r) => r.operation === null);
    const edits = rows.filter((r) => r.operation === "edit");
    expect(live).toBeDefined();
    expect(edits.length).toBeGreaterThanOrEqual(1);
    // edit 的 in_reply_to 指向首条流式消息（宿主据此解析编辑目标）
    for (const e of edits) expect(e.in_reply_to).toBe(live!.id);
    // 最终内容为完整结果
    expect(rows[rows.length - 1]!.content).toBe("Hello world");
    // ack completed
    const ack = getOutboundDb().prepare("SELECT status FROM processing_ack WHERE message_id='s1'").get() as { status: string };
    expect(ack.status).toBe("completed");
  });
});
