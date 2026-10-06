/**
 * cli/resources/destinations.ts —— destinations 资源（crud + add/remove/verify）
 *
 * 职责：中央 allowlist（agent_destinations）+ 会话 inbound 投影一致性。
 *       真实模型：容器看到的 destinations 表在每个会话的 inbound.db 里，由
 *       writeDestinations() 从「其他 Agent 群组 + 本组已接线通道 + 中央 allowlist」派生，
 *       同时充当 a2a 路由表与 ACL。因此 add/remove 必须写完中央行后立刻重投影并回读校验，
 *       否则中央表与容器可见面会静默漂移。
 * 关键导出：registerDestinationsResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/destinations.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCommand } from "../registry.js";
import { registerCrudResource } from "../crud.js";
import { getDb } from "../../db/connection.js";
import { getAgentGroup } from "../../db/agent-groups.js";
import { listSessions } from "../../db/sessions.js";
import { inboundDbPath } from "../../session-manager.js";
import { openInboundDb } from "../../db/session-db.js";
import { LocalizedError } from "../../i18n/index.js";

/** 重投影本组全部会话并回读比对，返回一致性判定（漂移时列出分歧会话）。 */
async function reprojectAndVerify(groupId: string): Promise<{
  sessions: number;
  consistent: boolean;
  projected: number;
  drift: string[];
}> {
  const { writeDestinations } = await import("../../modules/agent-to-agent.js");
  const sessions = listSessions().filter((s) => s.agent_group_id === groupId);
  const drift: string[] = [];
  let projected = 0;
  let baseline: string | null = null;
  for (const s of sessions) {
    try {
      writeDestinations(s);
    } catch {
      drift.push(`${s.id}: reproject failed`);
      continue;
    }
    const inbound = openInboundDb(inboundDbPath(s.agent_group_id, s.id));
    try {
      const rows = inbound.prepare("SELECT name, type FROM destinations ORDER BY name").all() as Array<{
        name: string;
        type: string;
      }>;
      const sig = rows.map((r) => `${r.type}:${r.name}`).join(",");
      projected = rows.length;
      if (baseline === null) baseline = sig;
      else if (baseline !== sig) drift.push(`${s.id}: projection differs`);
    } catch {
      drift.push(`${s.id}: read failed`);
    } finally {
      inbound.close();
    }
  }
  return { sessions: sessions.length, consistent: drift.length === 0, projected, drift };
}

export function registerDestinationsResource(): void {
  registerCommand({
    resource: "destinations",
    verb: "add",
    scope: "host",
    description: "Grant an explicit destination, re-project every session of the group, then verify consistency.",
    flags: [
      { name: "group", description: "Agent group id (alias: --agent-group).", required: true },
      {
        name: "destination",
        description: "Destination name (agent folder or chat:<messaging_group_id>).",
        required: true,
      },
      { name: "type", description: "Destination kind.", default: "agent", enum: ["agent", "channel"] },
    ],
    handler: async (args) => {
      const groupId = args.flags.group ?? args.flags["agent-group"];
      const destination = args.flags.destination;
      if (!groupId || !destination) throw new LocalizedError("cli.destination_flags_required", {}, "invalid-args");
      if (!getAgentGroup(groupId)) throw new LocalizedError("cli.not_found", { id: groupId }, "not-found");
      const type = args.flags.type === "channel" ? "channel" : "agent";
      getDb()
        .prepare(
          `INSERT INTO agent_destinations (agent_group_id, destination, type, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(agent_group_id, destination) DO UPDATE SET type = excluded.type`,
        )
        .run(groupId, destination, type, new Date().toISOString());
      const verify = await reprojectAndVerify(groupId);
      return { ok: true, group: groupId, destination, type, ...verify };
    },
  });

  registerCommand({
    resource: "destinations",
    verb: "remove",
    scope: "host",
    description: "Revoke a destination grant, re-project every session of the group, then verify consistency.",
    flags: [
      { name: "group", description: "Agent group id (alias: --agent-group).", required: true },
      { name: "destination", description: "Destination name to revoke.", required: true },
    ],
    handler: async (args) => {
      const groupId = args.flags.group ?? args.flags["agent-group"];
      const destination = args.flags.destination;
      if (!groupId || !destination) throw new LocalizedError("cli.destination_flags_required", {}, "invalid-args");
      const removed = getDb()
        .prepare("DELETE FROM agent_destinations WHERE agent_group_id = ? AND destination = ?")
        .run(groupId, destination).changes;
      const verify = await reprojectAndVerify(groupId);
      return { ok: true, removed, group: groupId, destination, ...verify };
    },
  });

  registerCommand({
    resource: "destinations",
    verb: "verify",
    scope: "host",
    description: "Re-project and report whether every session of a group sees an identical destinations table.",
    flags: [{ name: "group", description: "Agent group id (alias: --agent-group).", required: true }],
    handler: async (args) => {
      const groupId = args.flags.group ?? args.flags["agent-group"];
      if (!groupId) throw new LocalizedError("cli.group_id_required", {}, "invalid-args");
      if (!getAgentGroup(groupId)) throw new LocalizedError("cli.not_found", { id: groupId }, "not-found");
      return { group: groupId, ...(await reprojectAndVerify(groupId)) };
    },
  });

  registerCrudResource("destinations", {
    table: "agent_destinations",
    columns: ["agent_group_id", "destination", "type", "created_at"],
    agentVisible: true,
    scopeField: "agent_group_id",
    noGet: true,
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
