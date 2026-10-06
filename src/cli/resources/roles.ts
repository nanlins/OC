/**
 * cli/resources/roles.ts —— roles 资源（crud + grant/revoke）
 *
 * 职责：roles list（CRUD 生成）+ grant/revoke（owner/admin，全局或组范围）。
 * 关键导出：registerRolesResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/roles.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCommand } from "../registry.js";
import { registerCrudResource } from "../crud.js";
import { grantRole, revokeRole } from "../../db/users.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerRolesResource(): void {
  registerCrudResource("roles", {
    table: "user_roles",
    columns: ["user_id", "role", "agent_group_id", "granted_at"],
  });

  registerCommand({
    resource: "roles",
    verb: "grant",
    scope: "host",
    description: "Grant owner/admin privilege to a user, globally or scoped to one group.",
    flags: [
      { name: "id", description: "User id (<channel>:<handle>).", required: true },
      { name: "role", description: "Privilege to grant.", required: true, enum: ["owner", "admin"] },
      { name: "group", description: "Agent group id; omit for a global role." },
    ],
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
    description: "Revoke owner/admin privilege from a user.",
    flags: [
      { name: "id", description: "User id (<channel>:<handle>).", required: true },
      { name: "role", description: "Privilege to revoke.", required: true, enum: ["owner", "admin"] },
      { name: "group", description: "Agent group id; omit for a global role." },
    ],
    handler: (args) => {
      if (!args.id || !args.flags.role) throw new LocalizedError("cli.user_role_required", {}, "invalid-args");
      return { ok: revokeRole(args.id, args.flags.role as "owner" | "admin", args.flags.group ?? null) };
    },
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
