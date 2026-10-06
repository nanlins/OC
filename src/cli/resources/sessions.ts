/**
 * cli/resources/sessions.ts —— sessions 资源（crud + history）
 *
 * 职责：sessions list/get（CRUD 生成）+ history（跨会话翻聊天记录，agent 面组隔离）。
 * 关键导出：registerSessionsResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/sessions.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCommand } from "../registry.js";
import { registerCrudResource } from "../crud.js";
import { listSessions } from "../../db/sessions.js";
import { inboundDbPath } from "../../session-manager.js";
import { openInboundDb } from "../../db/session-db.js";

export function registerSessionsResource(): void {
  registerCrudResource("sessions", {
    table: "sessions",
    columns: ["id", "agent_group_id", "messaging_group_id", "thread_id", "status", "container_status", "last_active"],
    scopeField: "agent_group_id",
    agentVisible: true,
  });

  // P1-10: sessions history command
  registerCommand({
    resource: "sessions",
    verb: "history",
    scope: "agent-group",
    agentVisible: true,
    description: "Recent inbound messages across this agent group's sessions (group-isolated).",
    handler: (_args, caller) => {
      const sessions = listSessions();
      const filtered = caller.agentGroupId
        ? sessions.filter((s) => s.agent_group_id === caller.agentGroupId)
        : sessions;
      const rows: Array<Record<string, unknown>> = [];
      for (const s of filtered.slice(0, 20)) {
        const inbound = openInboundDb(inboundDbPath(s.agent_group_id, s.id));
        try {
          const msgs = inbound
            .prepare("SELECT seq, kind, content, sender_id, created_at FROM messages_in ORDER BY seq DESC LIMIT 10")
            .all() as Array<Record<string, unknown>>;
          rows.push(...msgs.map((m) => ({ ...m, session_id: s.id, thread_id: s.thread_id })));
        } catch {
          /* session DB may not exist yet */
        } finally {
          inbound.close();
        }
      }
      return rows;
    },
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
