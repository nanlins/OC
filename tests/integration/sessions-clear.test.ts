/**
 * sessions-clear.test.ts -- session context clearing + CLI session resolution (P0-1, P1-2, P1-3).
 *
 * Responsibility:
 *   P0-1  `oc sessions clear <id>` must actually delete the agent's conversation state
 *         and must NOT touch tasks, delivery bookkeeping, destinations or undelivered
 *         replies. The old handler returned {cleared:true} without writing anything.
 *   P1-2  /clear and /new share one implementation.
 *   P1-3  slash commands act on the session the CLI channel actually resolves to,
 *         not on "whichever session was active most recently anywhere".
 *
 * Modification record:
 *   2026-10-06  Created (P0-1 / P1-2 / P1-3)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDb,
  initTestDb,
  runMigrations,
  migration001,
  migration002,
  createAgentGroup,
  createMessagingGroup,
  createWiring,
} from "../../src/db/index.js";
import {
  clearSessionContext,
  inboundDbPath,
  outboundDbPath,
  resolveSession,
  writeSessionMessage,
} from "../../src/session-manager.js";
import { openInboundDb, openOutboundDb, openOutboundDbRw } from "../../src/db/session-db.js";
import { resolveCliSession } from "../../src/modules/chat-commands.js";
import { handleCliLine } from "../../src/cli/socket-server.js";
import { touchSession } from "../../src/db/sessions.js";
import type { ResponseFrame } from "../../src/cli/frame.js";
import type { Session } from "../../src/types.js";

/** Seed conversation state the way the container's poll-loop would have left it. */
function seedSessionState(session: Session): void {
  const db = openOutboundDbRw(outboundDbPath(session.agent_group_id, session.id));
  try {
    const stmt = db.prepare("INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES (?, ?, ?)");
    const now = new Date().toISOString();
    stmt.run("history:claude", '[{"role":"user","content":"earlier turn"}]', now);
    stmt.run("continuation:claude", "msg_01ABC", now);
    stmt.run("current_in_reply_to", "m-1", now);
    stmt.run("todos", "[]", now);
    // A key that is NOT conversation state and must survive the clear.
    stmt.run("unrelated:keepme", "survives", now);
  } finally {
    db.close();
  }
}

function readStateKeys(session: Session): string[] {
  const db = openOutboundDb(outboundDbPath(session.agent_group_id, session.id));
  try {
    return (db.prepare("SELECT key FROM session_state ORDER BY key").all() as Array<{ key: string }>).map((r) => r.key);
  } finally {
    db.close();
  }
}

let groupA: string;

beforeEach(() => {
  runMigrations(initTestDb(), [migration001, migration002]);
  groupA = createAgentGroup({ name: "A", folder: `a-${Math.random().toString(36).slice(2, 8)}` }).id;
});

afterEach(() => {
  closeDb();
});

describe("P0-1: clearSessionContext", () => {
  it("deletes conversation state and reports how many keys went away", () => {
    const session = resolveSession({ agentGroupId: groupA, sessionMode: "agent-shared" });
    seedSessionState(session);
    expect(readStateKeys(session)).toContain("history:claude");

    const removed = clearSessionContext(session);

    expect(removed).toBe(4);
    const left = readStateKeys(session);
    expect(left).not.toContain("history:claude");
    expect(left).not.toContain("continuation:claude");
    expect(left).not.toContain("current_in_reply_to");
    expect(left).not.toContain("todos");
  });

  it("preserves non-conversation session_state keys", () => {
    const session = resolveSession({ agentGroupId: groupA, sessionMode: "agent-shared" });
    seedSessionState(session);
    clearSessionContext(session);
    expect(readStateKeys(session)).toContain("unrelated:keepme");
  });

  it("preserves inbound messages, tasks, delivery bookkeeping and destinations", () => {
    const session = resolveSession({ agentGroupId: groupA, sessionMode: "agent-shared" });
    writeSessionMessage(session, { kind: "chat", content: "a user turn" });
    writeSessionMessage(session, { kind: "task", content: "a scheduled job" });

    const inbound = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
    try {
      inbound
        .prepare(
          "INSERT OR REPLACE INTO delivered (message_out_id, platform_message_id, status, delivered_at) VALUES ('out-1', NULL, 'delivered', ?)",
        )
        .run(new Date().toISOString());
      inbound
        .prepare("INSERT OR REPLACE INTO destinations (name, display_name, type) VALUES ('peer','Peer','agent')")
        .run();
    } finally {
      inbound.close();
    }

    seedSessionState(session);
    clearSessionContext(session);

    const check = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
    try {
      expect((check.prepare("SELECT COUNT(*) AS n FROM messages_in").get() as { n: number }).n).toBe(2);
      expect(
        (check.prepare("SELECT COUNT(*) AS n FROM messages_in WHERE kind = 'task'").get() as { n: number }).n,
      ).toBe(1);
      expect((check.prepare("SELECT COUNT(*) AS n FROM delivered").get() as { n: number }).n).toBe(1);
      expect((check.prepare("SELECT COUNT(*) AS n FROM destinations").get() as { n: number }).n).toBe(1);
    } finally {
      check.close();
    }
  });

  it("preserves undelivered outbound replies", () => {
    const session = resolveSession({ agentGroupId: groupA, sessionMode: "agent-shared" });
    const db = openOutboundDbRw(outboundDbPath(session.agent_group_id, session.id));
    try {
      db.prepare(
        "INSERT INTO messages_out (id, seq, timestamp, kind, content) VALUES ('o1', 1, ?, 'chat', 'pending reply')",
      ).run(new Date().toISOString());
    } finally {
      db.close();
    }
    seedSessionState(session);

    clearSessionContext(session);

    const after = openOutboundDb(outboundDbPath(session.agent_group_id, session.id));
    try {
      expect((after.prepare("SELECT COUNT(*) AS n FROM messages_out").get() as { n: number }).n).toBe(1);
    } finally {
      after.close();
    }
  });

  it("is idempotent and safe before any container ever ran", () => {
    const session = resolveSession({ agentGroupId: groupA, sessionMode: "agent-shared" });
    expect(clearSessionContext(session)).toBe(0);
    seedSessionState(session);
    expect(clearSessionContext(session)).toBe(4);
    expect(clearSessionContext(session)).toBe(0);
  });

  it("returns 0 for a session whose directory does not exist", () => {
    const ghost = {
      id: "no-such-session",
      agent_group_id: groupA,
    } as Session;
    expect(clearSessionContext(ghost)).toBe(0);
  });
});

describe("P0-1: oc sessions clear over the CLI", () => {
  it("clears state and reports clearedKeys (was a no-op returning {cleared:true})", async () => {
    const session = resolveSession({ agentGroupId: groupA, sessionMode: "agent-shared" });
    seedSessionState(session);

    const res = (await handleCliLine(JSON.stringify({ cmd: `sessions clear ${session.id}` }))) as ResponseFrame;

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ cleared: true, sessionId: session.id, clearedKeys: 4 });
    expect(readStateKeys(session)).not.toContain("history:claude");
  });

  it("rejects a missing id and an unknown session", async () => {
    const missing = await handleCliLine(JSON.stringify({ cmd: "sessions clear" }));
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe("invalid-args");

    const unknown = await handleCliLine(JSON.stringify({ cmd: "sessions clear does-not-exist" }));
    expect(unknown.ok).toBe(false);
    expect(unknown.code).toBe("not-found");
  });
});

describe("P1-3: resolveCliSession", () => {
  function wireCliGroup(agentGroupId: string): Session {
    const mg = createMessagingGroup({ channelType: "cli", platformId: "local" });
    createWiring({ messagingGroupId: mg.id, agentGroupId });
    return resolveSession({ agentGroupId, messagingGroupId: mg.id, sessionMode: "shared" });
  }

  it("returns null when the CLI channel has no messaging group", () => {
    expect(resolveCliSession()).toBeNull();
  });

  it("resolves the session belonging to the CLI channel", () => {
    const cliSession = wireCliGroup(groupA);
    expect(resolveCliSession()?.id).toBe(cliSession.id);
  });

  it("does NOT return a more recently active session from another group (the P1-3 bug)", () => {
    const cliSession = wireCliGroup(groupA);

    // A second, unrelated agent group whose session is touched LAST, so a
    // `listSessions().find(active)` guess would pick it (list is last_active DESC).
    const groupB = createAgentGroup({ name: "B", folder: `b-${Math.random().toString(36).slice(2, 8)}` }).id;
    const other = resolveSession({ agentGroupId: groupB, sessionMode: "agent-shared" });
    touchSession(other.id);

    expect(resolveCliSession()?.id).toBe(cliSession.id);
    expect(resolveCliSession()?.id).not.toBe(other.id);
  });

  it("returns null when the CLI messaging group exists but has no wiring", () => {
    createMessagingGroup({ channelType: "cli", platformId: "local" });
    expect(resolveCliSession()).toBeNull();
  });
});

/*
 * Modification record:
 *   2026-10-06  Created (P0-1 / P1-2 / P1-3)
 */
