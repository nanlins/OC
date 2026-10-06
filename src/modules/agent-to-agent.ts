/**
 * modules/agent-to-agent.ts —— Agent 间通信模块
 *
 * 职责：routeAgentMessage（kind=a2a 出站 → 目标 Agent 会话 inbound + wake）；
 *       writeDestinations（spawn 时刷新会话 inbound 的 destinations 表：其他 Agent + 通道 + 中央 allowlist）。
 * 关键导出：routeAgentMessage, writeDestinations, listAgentDestinations
 * 承重不变量：destinations 表同时是路由表和容器可见 ACL；宿主投递侧权威复核。
 * 借鉴：nanoclaw src/modules/agent-to-agent/
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 *   2026-10-05 P1-10：投影折入中央 agent_destinations allowlist；导出 listAgentDestinations
 */
import { randomUUID } from "node:crypto";
import { getAgentGroup, listAgentGroups } from "../db/agent-groups.js";
import { findSession, listSessions } from "../db/sessions.js";
import { resolveSession, writeSessionMessage, inboundDbPath } from "../session-manager.js";
import { openInboundDb } from "../db/session-db.js";
import { getDb } from "../db/connection.js";
import { wakeContainer } from "../container-runner.js";
import { log } from "../log.js";
import type { MessageOut, Session } from "../types.js";

/** a2a 出站：写入目标 Agent 的 agent-shared 会话 inbound（kind=a2a，带回程 source_session_id）。
 *  授权复核（阶段 6 复检 P1 修复）：目标必须存在于源会话的 destinations 投影（路由表即 ACL）。 */
export async function routeAgentMessage(out: MessageOut, sourceSession: Session): Promise<void> {
  const targetGroupId = out.platform_id;
  if (!targetGroupId || !getAgentGroup(targetGroupId)) {
    throw new Error(`a2a: unknown target agent group: ${targetGroupId}`);
  }
  const sourceInbound = openInboundDb(inboundDbPath(sourceSession.agent_group_id, sourceSession.id));
  let authorized = false;
  try {
    authorized =
      sourceInbound
        .prepare("SELECT 1 AS x FROM destinations WHERE type = 'agent' AND agent_group_id = ?")
        .get(targetGroupId) !== undefined;
  } finally {
    sourceInbound.close();
  }
  if (!authorized) {
    throw new Error(`a2a: unauthorized agent-to-agent target: ${targetGroupId}`);
  }
  const target =
    findSession({ agentGroupId: targetGroupId, sessionMode: "agent-shared" }) ??
    resolveSession({ agentGroupId: targetGroupId, sessionMode: "agent-shared" });
  writeSessionMessage(target, {
    id: randomUUID(),
    kind: "a2a",
    content: out.content,
    sourceSessionId: sourceSession.id,
    trigger: 1,
  });
  await wakeContainer(target);
  log.info(`a2a routed: ${sourceSession.id} -> ${target.id}`);
}

/** spawn 时刷新 destinations 投影（其他 Agent 群组 + 本群组已接线通道 + 中央 allowlist）。
 *  事务包裹（阶段 6 复检 P1 修复）：容器实时查询不得读到空/半截投影。
 *  中央 agent_destinations 是运维显式授权层，与派生行合并后一并投影（INSERT OR REPLACE
 *  以 (name) 去重，显式行覆盖同名派生行）。 */
export function writeDestinations(session: Session): void {
  const inbound = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
  try {
    const tx = inbound.transaction(() => {
      inbound.exec("DELETE FROM destinations");
      const stmt = inbound.prepare(
        `INSERT OR REPLACE INTO destinations (name, display_name, type, channel_type, platform_id, agent_group_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const g of listAgentGroups()) {
        if (g.id === session.agent_group_id) continue;
        stmt.run(g.folder, g.name, "agent", null, null, g.id);
      }
      for (const s of listSessions()) {
        if (s.agent_group_id !== session.agent_group_id || !s.messaging_group_id) continue;
        stmt.run(`chat:${s.messaging_group_id}`, null, "channel", null, s.messaging_group_id, null);
      }
      for (const d of listAgentDestinations(session.agent_group_id)) {
        stmt.run(d.destination, null, d.type, null, null, d.type === "agent" ? d.destination : null);
      }
    });
    tx();
  } finally {
    inbound.close();
  }
}

/** 中央 allowlist 读取：显式授权的目标（运维经 `oc destinations add` 写入）。 */
export function listAgentDestinations(agentGroupId: string): Array<{ destination: string; type: string }> {
  try {
    return getDb()
      .prepare("SELECT destination, type FROM agent_destinations WHERE agent_group_id = ? ORDER BY destination")
      .all(agentGroupId) as Array<{ destination: string; type: string }>;
  } catch {
    // 表尚未迁移（老库）时降级为纯派生投影，不得让 spawn 失败
    return [];
  }
}
