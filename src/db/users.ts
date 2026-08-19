/**
 * users.ts —— users / user_roles / agent_group_members CRUD
 *
 * 职责：平台身份登记（命名空间化 id `<channel>:<handle>`）与用户级权限解析。
 * 关键导出：upsertUser, getUser, findUsersByLinkKey, grantRole, revokeRole, getRoles,
 *           hasAdminPrivilege, canAccessAgentGroup, addMember, removeMember, isMember
 * 承重不变量：权限在用户级而非群组级；owner 必须全局（agent_group_id IS NULL）；
 *           admin @ A 隐含是 A 的成员（无需 members 行）。
 * 借鉴：nanoclaw src/modules/permissions/access.ts + src/db（user_roles）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 */
import { getDb } from "./connection.js";
import type { AgentGroupMember, User, UserRole } from "../types.js";

export function upsertUser(id: string, kind: string, displayName?: string, linkKey?: string): User {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO users (id, kind, display_name, link_key, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET display_name = COALESCE(excluded.display_name, display_name),
                                      link_key = COALESCE(excluded.link_key, link_key)`,
    )
    .run(id, kind, displayName ?? null, linkKey ?? null, now);
  return getUser(id)!;
}

export function getUser(id: string): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

/** 增强：跨通道 linking（同一自然人多平台身份） */
export function findUsersByLinkKey(linkKey: string): User[] {
  return getDb().prepare("SELECT * FROM users WHERE link_key = ?").all(linkKey) as User[];
}

export function listUsers(): User[] {
  return getDb().prepare("SELECT * FROM users ORDER BY created_at").all() as User[];
}

// ---- 角色 ----

export function grantRole(
  userId: string,
  role: "owner" | "admin",
  agentGroupId: string | null,
  grantedBy?: string,
): void {
  if (role === "owner" && agentGroupId !== null) {
    throw new Error("owner role must be global (agent_group_id IS NULL)");
  }
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_roles (user_id, role, agent_group_id, granted_by, granted_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(userId, role, agentGroupId, grantedBy ?? null, new Date().toISOString());
}

export function revokeRole(userId: string, role: "owner" | "admin", agentGroupId: string | null): boolean {
  return (
    getDb()
      .prepare("DELETE FROM user_roles WHERE user_id = ? AND role = ? AND agent_group_id IS ?")
      .run(userId, role, agentGroupId).changes === 1
  );
}

export function getRoles(userId: string): UserRole[] {
  return getDb().prepare("SELECT * FROM user_roles WHERE user_id = ?").all(userId) as UserRole[];
}

export function isOwner(userId: string): boolean {
  return getRoles(userId).some((r) => r.role === "owner" && r.agent_group_id === null);
}

/** owner > global admin > scoped admin（借鉴 nanoclaw hasAdminPrivilege 判定链） */
export function hasAdminPrivilege(userId: string, agentGroupId?: string | null): boolean {
  const roles = getRoles(userId);
  if (roles.some((r) => r.role === "owner" && r.agent_group_id === null)) return true;
  if (roles.some((r) => r.role === "admin" && r.agent_group_id === null)) return true;
  if (agentGroupId) return roles.some((r) => r.role === "admin" && r.agent_group_id === agentGroupId);
  return false;
}

export type AccessDecision =
  | { kind: "unknown_user" }
  | { kind: "owner" }
  | { kind: "global_admin" }
  | { kind: "admin_of_group" }
  | { kind: "member" }
  | { kind: "not_member" };

/** 访问判定链（借鉴 nanoclaw access.ts canAccessAgentGroup 可判别联合） */
export function canAccessAgentGroup(userId: string | null, agentGroupId: string): AccessDecision {
  if (!userId || !getUser(userId)) return { kind: "unknown_user" };
  const roles = getRoles(userId);
  if (roles.some((r) => r.role === "owner" && r.agent_group_id === null)) return { kind: "owner" };
  if (roles.some((r) => r.role === "admin" && r.agent_group_id === null)) return { kind: "global_admin" };
  if (roles.some((r) => r.role === "admin" && r.agent_group_id === agentGroupId)) return { kind: "admin_of_group" };
  if (isMember(userId, agentGroupId)) return { kind: "member" };
  return { kind: "not_member" };
}

// ---- 成员 ----

export function addMember(userId: string, agentGroupId: string, addedBy?: string): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO agent_group_members (user_id, agent_group_id, added_by, added_at) VALUES (?, ?, ?, ?)`,
    )
    .run(userId, agentGroupId, addedBy ?? null, new Date().toISOString());
}

export function removeMember(userId: string, agentGroupId: string): boolean {
  return (
    getDb()
      .prepare("DELETE FROM agent_group_members WHERE user_id = ? AND agent_group_id = ?")
      .run(userId, agentGroupId).changes === 1
  );
}

export function isMember(userId: string, agentGroupId: string): boolean {
  return (
    getDb()
      .prepare("SELECT 1 FROM agent_group_members WHERE user_id = ? AND agent_group_id = ?")
      .get(userId, agentGroupId) !== undefined
  );
}

export function listMembers(agentGroupId: string): AgentGroupMember[] {
  return getDb()
    .prepare("SELECT * FROM agent_group_members WHERE agent_group_id = ?")
    .all(agentGroupId) as AgentGroupMember[];
}
