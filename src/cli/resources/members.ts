/**
 * cli/resources/members.ts —— members 资源（crud + add/remove）
 *
 * 职责：members list（CRUD 生成）+ add/remove（非特权访问门）。
 * 关键导出：registerMembersResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/members.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCommand } from "../registry.js";
import { registerCrudResource } from "../crud.js";
import { addMember, removeMember } from "../../db/users.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerMembersResource(): void {
  registerCrudResource("members", {
    table: "agent_group_members",
    columns: ["user_id", "agent_group_id", "added_at"],
    scopeField: "agent_group_id",
    agentVisible: true,
    noGet: true, // 复合主键无 id 列
  });

  registerCommand({
    resource: "members",
    verb: "add",
    scope: "admin",
    description: "Add a user to an agent group's unprivileged access gate.",
    flags: [
      { name: "id", description: "User id (<channel>:<handle>).", required: true },
      { name: "group", description: "Agent group id.", required: true },
    ],
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
    description: "Remove a user from an agent group's access gate.",
    flags: [
      { name: "id", description: "User id (<channel>:<handle>).", required: true },
      { name: "group", description: "Agent group id.", required: true },
    ],
    handler: (args) => {
      if (!args.id || !args.flags.group) throw new LocalizedError("cli.user_group_required", {}, "invalid-args");
      return { ok: removeMember(args.id, args.flags.group) };
    },
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
