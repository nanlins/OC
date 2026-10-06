/**
 * cli/resources/tasks.ts —— tasks 资源（全自定义动词，读/写会话 inbound 任务行）
 *
 * 职责：tasks list/cancel/create/pause/resume/delete——任务=消息行（kind='task'），
 *       跨该组全部任务会话扫描/更新。
 * 关键导出：registerTasksResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/tasks.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCommand } from "../registry.js";
import { listSessions } from "../../db/sessions.js";
import { inboundDbPath } from "../../session-manager.js";
import { openInboundDb } from "../../db/session-db.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerTasksResource(): void {
  // ---- tasks：读/写会话 inbound 任务行 ----
  registerCommand({
    resource: "tasks",
    verb: "list",
    scope: "agent-group",
    agentVisible: true,
    description: "List scheduled task rows for this agent group.",
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
    description: "Cancel a pending/paused task by task id or series id.",
    flags: [{ name: "id", description: "Task id or series id.", required: true }],
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

  // 阶段 12（tasks 全 CRUD 补齐）：create/pause/resume/delete
  registerCommand({
    resource: "tasks",
    verb: "create",
    scope: "agent-group",
    agentVisible: true,
    description: "Schedule a task. Provide --cron for recurrence or --process-after for a one-shot fire.",
    flags: [
      { name: "cron", description: "Cron expression for a recurring series." },
      { name: "process-after", description: "One-shot fire time (ISO UTC or local YYYY-MM-DD HH:mm)." },
      { name: "message", description: "Prompt delivered to the agent when the task fires.", required: true },
    ],
    handler: async (args, caller) => {
      const groupId = caller.agentGroupId;
      if (!groupId) throw new LocalizedError("cli.group_id_required", {}, "invalid-args");
      const cron = args.flags.cron as string | undefined;
      const processAfter = args.flags["process-after"] as string | undefined;
      const message = (args.flags.message as string | undefined) ?? args.positionals.join(" ");
      if (!cron && !processAfter) throw new LocalizedError("cli.task_cron_required", {}, "invalid-args");
      if (!message) throw new LocalizedError("cli.task_message_required", {}, "invalid-args");
      const { createTaskInternal } = await import("../../modules/scheduling/index.js");
      try {
        const result = createTaskInternal(groupId, { message, cron: cron ?? null, processAfter: processAfter ?? null });
        return { ok: true, seriesId: result.seriesId, next: result.next ?? null };
      } catch (err) {
        throw Object.assign(new Error(String(err)), { code: "invalid-args" });
      }
    },
  });

  registerCommand({
    resource: "tasks",
    verb: "pause",
    scope: "agent-group",
    agentVisible: true,
    description: "Pause a pending task or a whole series.",
    flags: [{ name: "id", description: "Task id or series id.", required: true }],
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
              "UPDATE messages_in SET status = 'paused' WHERE kind = 'task' AND status = 'pending' AND (series_id = ? OR id = ?)",
            )
            .run(args.id, args.id).changes;
        } finally {
          inbound.close();
        }
      }
      return { paused: n };
    },
  });

  registerCommand({
    resource: "tasks",
    verb: "resume",
    scope: "agent-group",
    agentVisible: true,
    description: "Resume a paused task or a whole series.",
    flags: [{ name: "id", description: "Task id or series id.", required: true }],
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
              "UPDATE messages_in SET status = 'pending' WHERE kind = 'task' AND status = 'paused' AND (series_id = ? OR id = ?)",
            )
            .run(args.id, args.id).changes;
        } finally {
          inbound.close();
        }
      }
      return { resumed: n };
    },
  });

  registerCommand({
    resource: "tasks",
    verb: "delete",
    scope: "agent-group",
    agentVisible: true,
    description: "Delete task rows for a task id or a whole series.",
    flags: [{ name: "id", description: "Task id or series id.", required: true }],
    handler: (args, caller) => {
      if (!args.id) throw new LocalizedError("cli.task_id_required", {}, "invalid-args");
      let n = 0;
      for (const s of listSessions()) {
        if (!(s.thread_id ?? "").startsWith("system:tasks:")) continue;
        if (caller.agentGroupId && s.agent_group_id !== caller.agentGroupId) continue;
        const inbound = openInboundDb(inboundDbPath(s.agent_group_id, s.id));
        try {
          n += inbound
            .prepare("DELETE FROM messages_in WHERE kind = 'task' AND (series_id = ? OR id = ?)")
            .run(args.id, args.id).changes;
        } finally {
          inbound.close();
        }
      }
      return { deleted: n };
    },
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
