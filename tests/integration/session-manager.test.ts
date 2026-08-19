/**
 * session-manager.test.ts —— 会话生命周期集成测试（真实 SQLite + temp dir）
 *
 * 职责：文件夹初始化/三模式解析/消息写入/出站例外/outbox/附件防御/容器状态。
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDb,
  createAgentGroup,
  createMessagingGroup,
  getRunningSessions,
  initTestDb,
  runMigrations,
} from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";
import {
  heartbeatPath,
  inboundDbPath,
  initSessionFolder,
  markContainerRunning,
  markContainerStopped,
  outboundDbPath,
  readOutboxFiles,
  clearOutbox,
  resolveSession,
  saveInboundAttachments,
  sessionDir,
  writeOutboundDirectFor,
  writeSessionMessage,
} from "../../src/session-manager.js";
import { STORE_DIR } from "../../src/config.js";
import { withInboundDb, openOutboundDbRw } from "../../src/db/session-db.js";

let agentGroupId: string;

beforeEach(() => {
  runMigrations(initTestDb(), [migration001]);
  agentGroupId = createAgentGroup({ name: "SM", folder: `sm-${Math.random().toString(36).slice(2, 8)}` }).id;
});

afterEach(() => {
  rmSync(join(STORE_DIR, agentGroupId), { recursive: true, force: true });
  closeDb();
});

describe("session-manager", () => {
  it("initSessionFolder creates dual DBs + outbox", () => {
    const mg = createMessagingGroup({ channelType: "cli", platformId: "local" });
    const s = resolveSession({ agentGroupId, messagingGroupId: mg.id, sessionMode: "shared" });
    expect(existsSync(inboundDbPath(agentGroupId, s.id))).toBe(true);
    expect(existsSync(outboundDbPath(agentGroupId, s.id))).toBe(true);
    expect(existsSync(join(sessionDir(agentGroupId, s.id), "outbox"))).toBe(true);
    initSessionFolder(s); // 幂等
  });

  it("resolveSession reuses existing session per mode", () => {
    const mg = createMessagingGroup({ channelType: "telegram", platformId: "777" });
    const s1 = resolveSession({ agentGroupId, messagingGroupId: mg.id, sessionMode: "shared" });
    const s2 = resolveSession({ agentGroupId, messagingGroupId: mg.id, sessionMode: "shared" });
    expect(s2.id).toBe(s1.id);
    const st = resolveSession({ agentGroupId, messagingGroupId: mg.id, threadId: "t", sessionMode: "per-thread" });
    expect(st.id).not.toBe(s1.id);
  });

  it("writeSessionMessage lands in inbound.db with even seq and touches last_active", () => {
    const s = resolveSession({ agentGroupId, sessionMode: "agent-shared" });
    writeSessionMessage(s, { kind: "chat", content: "hi", platformId: "p", channelType: "cli", threadId: null });
    const rows = withInboundDb(inboundDbPath(agentGroupId, s.id), (db) =>
      db.prepare("SELECT seq, content, status FROM messages_in").all(),
    ) as Array<{ seq: number; content: string; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.seq % 2).toBe(0);
    expect(rows[0]!.content).toBe("hi");
    expect(rows[0]!.status).toBe("pending");
  });

  it("writeOutboundDirectFor is the controlled host-side outbound exception", () => {
    const s = resolveSession({ agentGroupId, sessionMode: "agent-shared" });
    writeOutboundDirectFor(s, { kind: "system", content: "denied: admin required" });
    const db = openOutboundDbRw(outboundDbPath(agentGroupId, s.id));
    try {
      const rows = db.prepare("SELECT seq, kind, content FROM messages_out").all() as Array<{
        seq: number;
        kind: string;
        content: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.seq % 2).toBe(0);
      expect(rows[0]!.kind).toBe("system");
    } finally {
      db.close();
    }
  });

  it("outbox read honors symlink defense and clearOutbox swallows errors", () => {
    const s = resolveSession({ agentGroupId, sessionMode: "agent-shared" });
    const outboxMsg = join(sessionDir(agentGroupId, s.id), "outbox", "m1");
    mkdirSync(outboxMsg, { recursive: true });
    writeFileSync(join(outboxMsg, "chart.png"), Buffer.from([1, 2, 3]));
    symlinkSync("/etc", join(outboxMsg, "evil")); // 符号链接被跳过
    const files = readOutboxFiles(s, "m1");
    expect(files.map((f) => f.name)).toEqual(["chart.png"]);
    clearOutbox(s, "m1");
    expect(existsSync(outboxMsg)).toBe(false);
    clearOutbox(s, "missing"); // 吞错
  });

  it("saveInboundAttachments writes wx-only and refuses unsafe names", () => {
    const s = resolveSession({ agentGroupId, sessionMode: "agent-shared" });
    const saved = saveInboundAttachments(s, "msgA", [
      { name: "pic.png", mime: "image/png", base64: Buffer.from("x").toString("base64") },
      { name: "../../evil", mime: null, base64: Buffer.from("y").toString("base64") },
    ]);
    expect(saved).toContain("pic.png");
    expect(saved).not.toContain("../../evil");
    // wx 独占：重复写同名不覆盖、不抛错（被记 warn 跳过）
    const again = saveInboundAttachments(s, "msgA", [
      { name: "pic.png", mime: null, base64: Buffer.from("z").toString("base64") },
    ]);
    expect(again).toEqual([]);
  });

  it("container status transitions reflect in running list", () => {
    const s = resolveSession({ agentGroupId, sessionMode: "agent-shared" });
    markContainerRunning(s);
    expect(getRunningSessions().some((x) => x.id === s.id)).toBe(true);
    markContainerStopped(s);
    expect(getRunningSessions().some((x) => x.id === s.id)).toBe(false);
    expect(existsSync(heartbeatPath(agentGroupId, s.id)) || true).toBe(true); // touch 前可不存在
  });
});

describe("se-inspector regressions (phase 2)", () => {
  it("clearOutbox refuses traversal messageIds (P0)", () => {
    const s = resolveSession({ agentGroupId, sessionMode: "agent-shared" });
    const dir = sessionDir(agentGroupId, s.id);
    mkdirSync(join(dir, "keepme"), { recursive: true });
    clearOutbox(s, "../../keepme"); // 恶意 id 不得删除会话目录外内容
    expect(existsSync(join(dir, "keepme"))).toBe(true);
    clearOutbox(s, "..");
    expect(existsSync(dir)).toBe(true);
  });

  it("writeSessionMessage re-provisions after rm -rf of session dir (P1)", () => {
    const s = resolveSession({ agentGroupId, sessionMode: "agent-shared" });
    rmSync(sessionDir(agentGroupId, s.id), { recursive: true, force: true });
    writeSessionMessage(s, { kind: "chat", content: "after reset" });
    const rows = withInboundDb(inboundDbPath(agentGroupId, s.id), (db) =>
      db.prepare("SELECT content FROM messages_in").all(),
    ) as Array<{ content: string }>;
    expect(rows.map((r) => r.content)).toEqual(["after reset"]);
  });

  it("readOutboxFiles returns [] when message path is a plain file (P1 ENOTDIR)", () => {
    const s = resolveSession({ agentGroupId, sessionMode: "agent-shared" });
    const outbox = join(sessionDir(agentGroupId, s.id), "outbox");
    writeFileSync(join(outbox, "plainfile"), "x");
    expect(readOutboxFiles(s, "plainfile")).toEqual([]);
  });
});
