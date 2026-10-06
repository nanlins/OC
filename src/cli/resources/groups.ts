/**
 * cli/resources/groups.ts —— groups 资源（crud + create）
 *
 * 职责：groups list/get（CRUD 生成）+ create（--name --folder [--provider]）。
 * 关键导出：registerGroupsResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/groups.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCommand } from "../registry.js";
import { registerCrudResource } from "../crud.js";
import { createAgentGroup } from "../../db/agent-groups.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerGroupsResource(): void {
  registerCrudResource("groups", {
    table: "agent_groups",
    columns: ["id", "name", "folder", "agent_provider", "created_at"],
    scopeField: "id", // P1 修复：agent 面仅本组，跨组枚举拒绝
    agentVisible: true,
  });

  registerCommand({
    resource: "groups",
    verb: "create",
    scope: "host",
    description: "Create an agent group (workspace + container config).",
    flags: [
      { name: "name", description: "Display name of the group.", required: true },
      { name: "folder", description: "Workspace folder under groups/.", required: true },
      { name: "provider", description: "LLM provider for this group.", enum: ["claude", "openai", "ollama", "mock"] },
    ],
    handler: (args) => {
      const name = args.flags.name;
      const folder = args.flags.folder;
      if (!name || !folder) throw new LocalizedError("cli.name_folder_required", {}, "invalid-args");
      return createAgentGroup({ name, folder, agentProvider: args.flags.provider });
    },
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
