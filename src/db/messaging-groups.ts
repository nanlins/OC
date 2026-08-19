/**
 * messaging-groups.ts —— messaging_groups + messaging_group_agents（wiring）CRUD
 *
 * 职责：平台群组/频道登记与「消息群组 ↔ Agent 群组」多对多绑定（四正交轴）。
 * 关键导出：createMessagingGroup, getMessagingGroup, findByPlatform, getMessagingGroupWithAgentCount,
 *           createWiring, getWiring, listWirings, updateWiring, deleteWiring, recordDeniedSender
 * 承重不变量：入站查找精确（channel_type+platform_id+instance），未接线通道常见路径一次读短路。
 * 借鉴：nanoclaw src/db/messaging-groups.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 */
import { randomUUID } from "node:crypto";
import { getDb } from "./connection.js";
import type { MessagingGroup, MessagingGroupAgent, UnknownSenderPolicy } from "../types.js";

export function createMessagingGroup(opts: {
  channelType: string;
  platformId: string;
  instance?: string;
  name?: string;
  isGroup?: boolean;
  unknownSenderPolicy?: UnknownSenderPolicy;
}): MessagingGroup {
  const row: MessagingGroup = {
    id: randomUUID(),
    channel_type: opts.channelType,
    platform_id: opts.platformId,
    instance: opts.instance ?? opts.channelType,
    name: opts.name ?? null,
    is_group: opts.isGroup ? 1 : 0,
    unknown_sender_policy: opts.unknownSenderPolicy ?? "strict",
    denied_at: null,
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO messaging_groups
        (id, channel_type, platform_id, instance, name, is_group, unknown_sender_policy, denied_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.channel_type,
      row.platform_id,
      row.instance,
      row.name,
      row.is_group,
      row.unknown_sender_policy,
      row.denied_at,
      row.created_at,
    );
  return row;
}

export function getMessagingGroup(id: string): MessagingGroup | undefined {
  return getDb().prepare("SELECT * FROM messaging_groups WHERE id = ?").get(id) as MessagingGroup | undefined;
}

/** 入站精确查找：三元自然键 */
export function findByPlatform(channelType: string, platformId: string, instance: string): MessagingGroup | undefined {
  return getDb()
    .prepare("SELECT * FROM messaging_groups WHERE channel_type = ? AND platform_id = ? AND instance = ?")
    .get(channelType, platformId, instance) as MessagingGroup | undefined;
}

/** 组合查询：mg 行 + 接线 agent 数（router 快速丢弃路径，一次 DB 读） */
export function getMessagingGroupWithAgentCount(
  channelType: string,
  platformId: string,
  instance: string,
): { group: MessagingGroup; agentCount: number } | undefined {
  const row = getDb()
    .prepare(
      `SELECT mg.*, (SELECT COUNT(*) FROM messaging_group_agents mga WHERE mga.messaging_group_id = mg.id) AS agent_count
       FROM messaging_groups mg
       WHERE mg.channel_type = ? AND mg.platform_id = ? AND mg.instance = ?`,
    )
    .get(channelType, platformId, instance) as (MessagingGroup & { agent_count: number }) | undefined;
  if (!row) return undefined;
  const { agent_count, ...group } = row;
  return { group, agentCount: agent_count };
}

export function markDenied(id: string): void {
  getDb().prepare("UPDATE messaging_groups SET denied_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

// ---- wiring ----

export function createWiring(opts: {
  messagingGroupId: string;
  agentGroupId: string;
  engageMode?: MessagingGroupAgent["engage_mode"];
  engagePattern?: string;
  senderScope?: MessagingGroupAgent["sender_scope"];
  ignoredMessagePolicy?: MessagingGroupAgent["ignored_message_policy"];
  sessionMode?: MessagingGroupAgent["session_mode"];
  priority?: number;
  threads?: number | null;
}): MessagingGroupAgent {
  const row: MessagingGroupAgent = {
    id: randomUUID(),
    messaging_group_id: opts.messagingGroupId,
    agent_group_id: opts.agentGroupId,
    engage_mode: opts.engageMode ?? "mention",
    engage_pattern: opts.engagePattern ?? null,
    sender_scope: opts.senderScope ?? "all",
    ignored_message_policy: opts.ignoredMessagePolicy ?? "drop",
    session_mode: opts.sessionMode ?? "shared",
    priority: opts.priority ?? 0,
    threads: opts.threads ?? null,
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO messaging_group_agents
        (id, messaging_group_id, agent_group_id, engage_mode, engage_pattern,
         sender_scope, ignored_message_policy, session_mode, priority, threads, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.messaging_group_id,
      row.agent_group_id,
      row.engage_mode,
      row.engage_pattern,
      row.sender_scope,
      row.ignored_message_policy,
      row.session_mode,
      row.priority,
      row.threads,
      row.created_at,
    );
  return row;
}

export function listWirings(messagingGroupId: string): MessagingGroupAgent[] {
  return getDb()
    .prepare("SELECT * FROM messaging_group_agents WHERE messaging_group_id = ? ORDER BY priority DESC")
    .all(messagingGroupId) as MessagingGroupAgent[];
}

export function getWiring(id: string): MessagingGroupAgent | undefined {
  return getDb().prepare("SELECT * FROM messaging_group_agents WHERE id = ?").get(id) as
    MessagingGroupAgent | undefined;
}

const WIRING_UPDATABLE = new Set([
  "engage_mode",
  "engage_pattern",
  "sender_scope",
  "ignored_message_policy",
  "session_mode",
  "priority",
  "threads",
]);

export function updateWiring(id: string, patch: Partial<MessagingGroupAgent>): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!WIRING_UPDATABLE.has(k)) throw new Error(`not updatable: ${k}`);
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return false;
  vals.push(id);
  return (
    getDb()
      .prepare(`UPDATE messaging_group_agents SET ${sets.join(", ")} WHERE id = ?`)
      .run(...vals).changes === 1
  );
}

export function deleteWiring(id: string): boolean {
  return getDb().prepare("DELETE FROM messaging_group_agents WHERE id = ?").run(id).changes === 1;
}

// ---- 丢弃消息审计（unregistered_senders 聚合 upsert） ----

export function recordDeniedSender(messagingGroupId: string, senderId: string, displayName?: string | null): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO unregistered_senders (messaging_group_id, sender_id, display_name, message_count, first_seen, last_seen)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT (messaging_group_id, sender_id)
       DO UPDATE SET message_count = message_count + 1, last_seen = ?, display_name = COALESCE(excluded.display_name, display_name)`,
    )
    .run(messagingGroupId, senderId, displayName ?? null, now, now, now);
}
