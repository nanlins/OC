/**
 * cli/resources.ts —— 资源命令注册（groups/wirings/users/roles/members/sessions/tasks/approvals/dropped）
 *
 * 职责：crud 生成 + 自定义动词；approvals resolve 为审批闭环入口（cli_command 审批后以原 caller 重放）；
 *       tasks list/cancel 读/写会话 inbound 任务行。
 * 关键导出：registerAllResources
 * 借鉴：nanoclaw src/cli/resources/*
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 *   2026-08-13 阶段 14：handler 参数错误改抛 LocalizedError（渲染缝隙按 locale 翻译）
 */
import { registerCommand } from "./registry.js";
import { registerCrudResource } from "./crud.js";
import { dispatch } from "./dispatch.js";
import { getDb } from "../db/connection.js";
import { createAgentGroup, getAgentGroup } from "../db/agent-groups.js";
import { createWiring } from "../db/messaging-groups.js";
import { grantRole, revokeRole, addMember, removeMember } from "../db/users.js";
import { listSessions, getSession } from "../db/sessions.js";
import { inboundDbPath } from "../session-manager.js";
import { openInboundDb } from "../db/session-db.js";
import { getPendingApproval } from "../modules/approvals.js";
import { addDocument, exportKbToDir } from "../modules/memory-kb.js";
import { resolveGroupFolderPath } from "../group-folder.js";
import { join } from "node:path";
import { registerEvalResource } from "./eval-resource.js";
import { randomUUID } from "node:crypto";
import type { CallerContext } from "./frame.js";
import { LocalizedError } from "../i18n/index.js";

let resourcesRegistered = false;

/** 幂等（web 与 cli 双入口共用） */
export function registerAllResources(): void {
  if (resourcesRegistered) return;
  resourcesRegistered = true;
  registerEvalResource();
  // fix-plan：KB 资源——add 写宿主 memory-kb；sync 物化到群组 kb/ 目录（容器 kb_search 读取）
  registerCommand({
    resource: "kb",
    verb: "add",
    scope: "host",
    handler: (args) => {
      const kb = (args.flags.kb as string) ?? "kb";
      const title = args.flags.title as string | undefined;
      const text = args.flags.text as string | undefined;
      if (!title || !text)
        throw Object.assign(new Error("kb add requires --title and --text"), { code: "invalid-args" });
      const docId = addDocument(kb, title, text, args.flags.source as string | undefined);
      return { ok: true, kb, docId };
    },
  });
  registerCommand({
    resource: "kb",
    verb: "sync",
    scope: "host",
    handler: (args) => {
      const kb = args.flags.kb as string | undefined;
      const groupId = args.flags.group as string | undefined;
      if (!kb || !groupId)
        throw Object.assign(new Error("kb sync requires --kb and --group"), { code: "invalid-args" });
      const group = getAgentGroup(groupId);
      if (!group) throw Object.assign(new Error(`agent group not found: ${groupId}`), { code: "not-found" });
      const kbDir = join(resolveGroupFolderPath(group.folder), "kb");
      const synced = exportKbToDir(kb, kbDir);
      return { ok: true, kb, group: group.folder, synced };
    },
  });
  registerCrudResource("groups", {
    table: "agent_groups",
    columns: ["id", "name", "folder", "agent_provider", "created_at"],
    scopeField: "id", // P1 修复：agent 面仅本组，跨组枚举拒绝
    agentVisible: true,
  });
  registerCrudResource("messaging-groups", {
    table: "messaging_groups",
    columns: ["id", "channel_type", "platform_id", "instance", "unknown_sender_policy", "denied_at", "created_at"],
    agentVisible: false, // P1 修复：无按组过滤列，host-only（简化记录在案）
  });
  registerCrudResource("wirings", {
    table: "messaging_group_agents",
    columns: ["id", "messaging_group_id", "agent_group_id", "engage_mode", "sender_scope", "session_mode", "priority"],
    scopeField: "agent_group_id",
    agentVisible: true,
  });
  registerCrudResource("users", {
    table: "users",
    columns: ["id", "kind", "display_name", "link_key", "created_at"],
  });
  registerCrudResource("sessions", {
    table: "sessions",
    columns: ["id", "agent_group_id", "messaging_group_id", "thread_id", "status", "container_status", "last_active"],
    scopeField: "agent_group_id",
    agentVisible: true,
  });
  registerCrudResource("dropped", {
    table: "unregistered_senders",
    columns: ["messaging_group_id", "sender_id", "display_name", "message_count", "last_seen"],
    noGet: true, // 复合主键无 id 列
  });
  registerCrudResource("members", {
    table: "agent_group_members",
    columns: ["user_id", "agent_group_id", "added_at"],
    scopeField: "agent_group_id",
    agentVisible: true,
    noGet: true, // 复合主键无 id 列
  });
  registerCrudResource("roles", {
    table: "user_roles",
    columns: ["user_id", "role", "agent_group_id", "granted_at"],
  });

  registerCommand({
    resource: "groups",
    verb: "create",
    scope: "host",
    handler: (args) => {
      const name = args.flags.name;
      const folder = args.flags.folder;
      if (!name || !folder) throw new LocalizedError("cli.name_folder_required", {}, "invalid-args");
      return createAgentGroup({ name, folder, agentProvider: args.flags.provider });
    },
  });

  registerCommand({
    resource: "wirings",
    verb: "create",
    scope: "host",
    handler: (args) => {
      if (!args.flags["messaging-group"] || !args.flags["agent-group"]) {
        throw new LocalizedError("cli.wiring_flags_required", {}, "invalid-args");
      }
      return createWiring({
        messagingGroupId: args.flags["messaging-group"],
        agentGroupId: args.flags["agent-group"],
        engageMode: (args.flags.engage as "mention" | "pattern" | "mention-sticky") ?? "mention",
        engagePattern: args.flags.pattern,
      });
    },
  });

  registerCommand({
    resource: "roles",
    verb: "grant",
    scope: "host",
    handler: (args, caller) => {
      if (!args.id || !args.flags.role) throw new LocalizedError("cli.user_role_required", {}, "invalid-args");
      grantRole(args.id, args.flags.role as "owner" | "admin", args.flags.group ?? null, caller.userId);
      return { ok: true };
    },
  });
  registerCommand({
    resource: "roles",
    verb: "revoke",
    scope: "host",
    handler: (args) => {
      if (!args.id || !args.flags.role) throw new LocalizedError("cli.user_role_required", {}, "invalid-args");
      return { ok: revokeRole(args.id, args.flags.role as "owner" | "admin", args.flags.group ?? null) };
    },
  });

  registerCommand({
    resource: "members",
    verb: "add",
    scope: "admin",
    handler: (args, caller) => {
      if (!args.id || !args.flags.group) throw new LocalizedError("cli.user_group_required", {}, "invalid-args");
      addMember(args.id, args.flags.group, caller.userId);
      return { ok: true };
    },
  });
  registerCommand({
    resource: "members",
    verb: "remove",
    scope: "admin",
    handler: (args) => {
      if (!args.id || !args.flags.group) throw new LocalizedError("cli.user_group_required", {}, "invalid-args");
      return { ok: removeMember(args.id, args.flags.group) };
    },
  });

  // ---- tasks：读/写会话 inbound 任务行 ----
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

  // ---- approvals：list + resolve（审批闭环入口） ----
  registerCrudResource("approvals", {
    table: "pending_approvals",
    columns: ["id", "action", "status", "title", "agent_group_id", "created_at"],
  });
  registerCommand({
    resource: "approvals",
    verb: "resolve",
    scope: "admin",
    handler: async (args, caller) => {
      // P1 修复：重放上下文禁止再 resolve（防审批嵌套传递授权）
      if (caller.approved || caller.replaying) {
        throw new LocalizedError("cli.nested_resolve_forbidden", {}, "forbidden");
      }
      if (!args.id || !args.flags.decision) {
        throw new LocalizedError("cli.approval_decision_required", {}, "invalid-args");
      }
      const decision = args.flags.decision;
      if (decision !== "approve" && decision !== "reject") {
        throw new LocalizedError("cli.decision_must_be", {}, "invalid-args");
      }
      const row = getPendingApproval(args.id);
      if (!row) return { resolved: false };
      if (decision === "reject") {
        getDb().prepare("DELETE FROM pending_approvals WHERE id = ?").run(args.id);
        return { resolved: true, decision };
      }
      if (row.action === "cli_command") {
        // cli_command 审批：以原 caller + approved/replaying 标记重放（审批即授权）；
        // P1 修复：先重放、成功后删行（恰好一次，失败保留可重试）
        const payload = JSON.parse(row.payload) as { cmd?: string; caller?: CallerContext };
        const replay = await dispatch(
          { cmd: payload.cmd ?? "", requestId: randomUUID() },
          { ...(payload.caller ?? caller), approved: true, replaying: true },
        );
        if (replay.ok) getDb().prepare("DELETE FROM pending_approvals WHERE id = ?").run(args.id);
        return replay;
      }
      // 投递动作审批：经 approvals.resolveApproval 回放（guard 查库验活行）
      const { resolveApproval } = await import("../modules/approvals.js");
      const session = getSession(row.session_id);
      const out = JSON.parse(row.payload) as { content?: string };
      if (!session) throw new LocalizedError("cli.session_gone", {}, "not-found");
      const ok = await resolveApproval(
        args.id,
        "approve",
        {
          content: out.content ?? row.payload,
          kind: "system",
          operation: null,
          platform_id: null,
          channel_type: "cli",
          thread_id: null,
        },
        session,
      );
      return { resolved: ok };
    },
  });
}
