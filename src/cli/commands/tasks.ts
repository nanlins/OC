/**
 * cli/commands/tasks.ts —— tasks 管理命令
 *
 * 职责：tasks list/cancel 命令，读/写会话 inbound 任务行。
 * 关键导出：registerTasksCommands（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { registerCommand } from "../registry.js";
import { listSessions } from "../../db/sessions.js";
import { inboundDbPath } from "../../session-manager.js";
import { openInboundDb } from "../../db/session-db.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerTasksCommands(): void {
  registerCommand({
    resource: "tasks",
    verb: "list",
    scope: "agent-group",
    agentVisible: true,
    handler: (_args, caller) => {
      const sessions = listSessions().filter(
        (s) =>
          (s.thread_id ?? "").startsWith("system:tasks:") &&
          (!caller.agentGroupId || s.agent_group_id === caller.agentGroupId),
      );
      const rows: Array<Record<string, unknown>> = [];
      for (const s of sessions) {
        const inbound = openInboundDb(inboundDbPath(s.agent_group_id, s.id));
        try {
          const tasks = inbound
            .prepare(
              "SELECT id, series_id, status, process_after, recurrence, content FROM messages_in WHERE kind = 'task' ORDER BY seq DESC LIMIT 50",
            )
            .all() as Array<Record<string, unknown>>;
          rows.push(...tasks.map((t) => ({ ...t, session_id: s.id })));
        } finally {
          inbound.close();
        }
      }
      return rows;
    },
  });

  registerCommand({
    resource: "tasks",
    verb: "cancel",
    scope: "agent-group",
    agentVisible: true,
    handler: (args, caller) => {
      if (!args.id) throw new LocalizedError("cli.task_id_required", {}, "invalid-args");
      let n = 0;
      for (const s of listSessions()) {
        if (!(s.thread_id ?? "").startsWith("system:tasks:")) continue;
        if (caller.agentGroupId && s.agent_group_id !== caller.agentGroupId) continue;
        const inbound = openInboundDb(inboundDbPath(s.agent_group_id, s.id));
        try {
          n += inbound
            .prepare(
              "UPDATE messages_in SET status = 'cancelled', recurrence = NULL WHERE kind = 'task' AND status IN ('pending', 'paused') AND (series_id = ? OR id = ?)",
            )
            .run(args.id, args.id).changes;
        } finally {
          inbound.close();
        }
      }
      return { cancelled: n };
    },
  });
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

