/**
 * db-v2.test.ts —— 中央 DB 集成测试（全迁移链 + CRUD 往返）
 *
 * 职责：迁移后全表存在；各 CRUD 模块行为正确（含权限判定链、wiring 组合查询、container config 幂等）。
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMember,
  canAccessAgentGroup,
  closeDb,
  createAgentGroup,
  createMessagingGroup,
  createSession,
  createWiring,
  ensureContainerConfig,
  findSession,
  getContainerConfig,
  getDb,
  getMessagingGroupWithAgentCount,
  getRoles,
  getRunningSessions,
  grantRole,
  hasAdminPrivilege,
  hasTable,
  initTestDb,
  listWirings,
  markContainerStatus,
  recordDeniedSender,
  runMigrations,
  updateContainerConfig,
  upsertUser,
} from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";

const CENTRAL_TABLES = [
  "agent_groups",
  "messaging_groups",
  "messaging_group_agents",
  "users",
  "user_roles",
  "agent_group_members",
  "user_dms",
  "sessions",
  "container_configs",
  "pending_approvals",
  "pending_questions",
  "unregistered_senders",
  "schema_version",
];

beforeEach(() => {
  const db = initTestDb();
  runMigrations(db, [migration001]);
});

afterEach(() => closeDb());

describe("central db migrations", () => {
  it("creates all central tables", () => {
    for (const t of CENTRAL_TABLES) {
      expect(hasTable(t), `table ${t}`).toBe(true);
    }
  });
});

describe("crud roundtrips", () => {
  it("agent group + container config ensure is idempotent", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const c1 = ensureContainerConfig(g.id);
    const c2 = ensureContainerConfig(g.id, "claude");
    expect(c1.agent_group_id).toBe(g.id);
    expect(c2.provider).toBe("claude");
    expect(updateContainerConfig(g.id, { model: "claude-sonnet-4-6", cli_scope: "global" })).toBe(true);
    expect(getContainerConfig(g.id)?.model).toBe("claude-sonnet-4-6");
    expect(getContainerConfig(g.id)?.cli_scope).toBe("global");
  });

  it("messaging group + wiring + combined count query", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const mg = createMessagingGroup({ channelType: "cli", platformId: "local" });
    expect(getMessagingGroupWithAgentCount("cli", "local", "cli")?.agentCount).toBe(0);
    createWiring({ messagingGroupId: mg.id, agentGroupId: g.id, engageMode: "pattern", engagePattern: "." });
    const combo = getMessagingGroupWithAgentCount("cli", "local", "cli");
    expect(combo?.agentCount).toBe(1);
    expect(listWirings(mg.id)[0]?.engage_mode).toBe("pattern");
  });

  it("session resolution honors session modes", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const mg = createMessagingGroup({ channelType: "telegram", platformId: "123" });
    const shared = createSession({ agentGroupId: g.id, messagingGroupId: mg.id });
    expect(findSession({ agentGroupId: g.id, messagingGroupId: mg.id, sessionMode: "shared" })?.id).toBe(shared.id);
    const perThread = createSession({ agentGroupId: g.id, messagingGroupId: mg.id, threadId: "t1" });
    expect(
      findSession({ agentGroupId: g.id, messagingGroupId: mg.id, threadId: "t1", sessionMode: "per-thread" })?.id,
    ).toBe(perThread.id);
    const agentShared = findSession({ agentGroupId: g.id, sessionMode: "agent-shared" });
    expect(agentShared).toBeDefined();
  });

  it("running sessions reflect container status", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const s = createSession({ agentGroupId: g.id });
    expect(getRunningSessions()).toHaveLength(0);
    markContainerStatus(s.id, "running");
    expect(getRunningSessions()[0]?.id).toBe(s.id);
  });

  it("permission chain: owner > global admin > scoped admin > member > not_member", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const owner = upsertUser("cli:owner", "cli");
    const gAdmin = upsertUser("cli:gadmin", "cli");
    const sAdmin = upsertUser("cli:sadmin", "cli");
    const member = upsertUser("cli:member", "cli");
    const stranger = upsertUser("cli:stranger", "cli");
    grantRole(owner.id, "owner", null);
    grantRole(gAdmin.id, "admin", null);
    grantRole(sAdmin.id, "admin", g.id);
    addMember(member.id, g.id);

    expect(canAccessAgentGroup(owner.id, g.id)).toEqual({ kind: "owner" });
    expect(canAccessAgentGroup(gAdmin.id, g.id)).toEqual({ kind: "global_admin" });
    expect(canAccessAgentGroup(sAdmin.id, g.id)).toEqual({ kind: "admin_of_group" });
    expect(canAccessAgentGroup(member.id, g.id)).toEqual({ kind: "member" });
    expect(canAccessAgentGroup(stranger.id, g.id)).toEqual({ kind: "not_member" });
    expect(canAccessAgentGroup(null, g.id)).toEqual({ kind: "unknown_user" });
    expect(hasAdminPrivilege(sAdmin.id, g.id)).toBe(true);
    expect(hasAdminPrivilege(sAdmin.id, "other-group")).toBe(false);
    expect(getRoles(owner.id)).toHaveLength(1);
  });

  it("owner role must be global", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const u = upsertUser("cli:x", "cli");
    expect(() => grantRole(u.id, "owner", g.id)).toThrow(/global/);
  });

  it("denied senders aggregate with ON CONFLICT", () => {
    const mg = createMessagingGroup({ channelType: "telegram", platformId: "999" });
    recordDeniedSender(mg.id, "tg:u1", "Alice");
    recordDeniedSender(mg.id, "tg:u1", "Alice2");
    const row = getDb().prepare("SELECT * FROM unregistered_senders").get() as {
      message_count: number;
      display_name: string;
    };
    expect(row.message_count).toBe(2);
    expect(row.display_name).toBe("Alice2");
  });
});

import {
  deleteAgentGroup,
  deleteWiring,
  findByPlatform,
  findUsersByLinkKey,
  getAgentGroup,
  getAgentGroupByFolder,
  getMessagingGroup,
  getSession,
  getWiring,
  isMember,
  isOwner,
  listActiveSessions,
  listAgentGroups,
  listMembers,
  listSessions,
  markDenied,
  markSessionClosed,
  removeMember,
  revokeRole,
  taskThreadId,
  touchSession,
  updateAgentGroup,
  updateWiring,
} from "../../src/db/index.js";

describe("se-inspector regressions (phase 1)", () => {
  it("findSession resolves task sessions with NULL messaging_group_id (P1-1)", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const task = createSession({ agentGroupId: g.id, threadId: taskThreadId("x") });
    expect(task.messaging_group_id).toBeNull();
    expect(findSession({ agentGroupId: g.id, messagingGroupId: null, sessionMode: "shared" })?.id).toBe(task.id);
    expect(findSession({ agentGroupId: g.id, sessionMode: "agent-shared" })).toBeUndefined();
  });

  it("ensureContainerConfig never overwrites an existing provider (P1-3)", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    ensureContainerConfig(g.id, "openai");
    ensureContainerConfig(g.id, "ollama");
    expect(getContainerConfig(g.id)?.provider).toBe("openai");
    expect(updateContainerConfig(g.id, { provider: "ollama" })).toBe(true);
    expect(getContainerConfig(g.id)?.provider).toBe("ollama");
  });

  it("agent_groups CRUD roundtrip with cascade delete of sessions", () => {
    const g = createAgentGroup({ name: "A", folder: "folder-a" });
    expect(updateAgentGroup(g.id, { name: "B" })).toBe(true);
    expect(getAgentGroup(g.id)?.name).toBe("B");
    expect(getAgentGroupByFolder("folder-a")?.id).toBe(g.id);
    expect(listAgentGroups()).toHaveLength(1);
    const s = createSession({ agentGroupId: g.id });
    expect(deleteAgentGroup(g.id)).toBe(true);
    expect(getAgentGroup(g.id)).toBeUndefined();
    expect(getSession(s.id)).toBeUndefined();
  });

  it("messaging: findByPlatform hit, markDenied sets denied_at, wiring get/update/delete roundtrip", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const mg = createMessagingGroup({ channelType: "telegram", platformId: "42" });
    expect(findByPlatform("telegram", "42", "telegram")?.id).toBe(mg.id);
    expect(getMessagingGroup(mg.id)?.denied_at).toBeNull();
    markDenied(mg.id);
    expect(getMessagingGroup(mg.id)?.denied_at).not.toBeNull();
    const w = createWiring({ messagingGroupId: mg.id, agentGroupId: g.id });
    expect(getWiring(w.id)?.priority).toBe(0);
    expect(updateWiring(w.id, { priority: 7 })).toBe(true);
    expect(getWiring(w.id)?.priority).toBe(7);
    expect(deleteWiring(w.id)).toBe(true);
    expect(getWiring(w.id)).toBeUndefined();
  });

  it("sessions: get/list roundtrip, closed session leaves active list, touchSession refreshes last_active", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const s = createSession({ agentGroupId: g.id });
    expect(getSession(s.id)?.id).toBe(s.id);
    expect(listSessions()).toHaveLength(1);
    expect(listActiveSessions().map((x) => x.id)).toContain(s.id);
    markSessionClosed(s.id);
    expect(listActiveSessions()).toHaveLength(0);
    expect(getSession(s.id)?.status).toBe("closed");
    getDb().prepare("UPDATE sessions SET last_active = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", s.id);
    touchSession(s.id);
    expect(getSession(s.id)?.last_active).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("users: linkKey lookup finds both identities, revokeRole clears owner, removeMember clears membership", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const u1 = upsertUser("telegram:alice", "telegram", "Alice", "link-1");
    const u2 = upsertUser("cli:alice", "cli", "Alice", "link-1");
    expect(
      findUsersByLinkKey("link-1")
        .map((u) => u.id)
        .sort(),
    ).toEqual(["cli:alice", "telegram:alice"]);
    grantRole(u1.id, "owner", null);
    expect(isOwner(u1.id)).toBe(true);
    expect(revokeRole(u1.id, "owner", null)).toBe(true);
    expect(isOwner(u1.id)).toBe(false);
    addMember(u2.id, g.id);
    expect(isMember(u2.id, g.id)).toBe(true);
    expect(listMembers(g.id).map((m) => m.user_id)).toEqual(["cli:alice"]);
    expect(removeMember(u2.id, g.id)).toBe(true);
    expect(isMember(u2.id, g.id)).toBe(false);
  });

  it("updateContainerConfig stores JSON columns as JSON strings and rejects unknown keys", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    ensureContainerConfig(g.id);
    const mcp = { fs: { command: "npx", args: ["-y", "mcp-fs"] } };
    expect(updateContainerConfig(g.id, { mcp_servers: mcp as unknown as string })).toBe(true);
    const stored = getContainerConfig(g.id)?.mcp_servers;
    expect(typeof stored).toBe("string");
    expect(JSON.parse(stored!)).toEqual(mcp);
    expect(() => updateContainerConfig(g.id, { agent_group_id: "hijack" })).toThrow(/not updatable/);
  });
});

/*
 * 修改记录：
 *   2026-08-12 末尾追加 se-inspector 阶段 1 回归测试：P1-1（findSession NULL messaging_group_id）、
 *              P1-3（ensureContainerConfig 不覆写 provider）、agent_groups/messaging/sessions/users CRUD 往返、
 *              updateContainerConfig JSON 列与白名单守卫；新增一条末尾 import 引入所需符号。
 */
