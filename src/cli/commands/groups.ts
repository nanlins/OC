/**
 * cli/commands/groups.ts —— groups 管理命令
 *
 * 职责：groups create 命令（从模板创建/直接创建），含 oc groups create --name --folder --template。
 * 关键导出：registerGroupsCommands（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { registerCommand } from "../registry.js";
import { createAgentGroup } from "../../db/agent-groups.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerGroupsCommands(): void {
  registerCommand({
    resource: "groups",
    verb: "create",
    scope: "host",
    handler: (args) => {
      const name = args.flags.name;
      const folder = args.flags.folder;
      if (!name || !folder) {
        throw new LocalizedError("cli.name_folder_required", {}, "invalid-args");
      }
      return createAgentGroup({ name, folder, agentProvider: args.flags.provider });
    },
  });

  registerCommand({
    resource: "groups",
    verb: "restart",
    scope: "host",
    handler: async (args) => {
      if (!args.id) throw new LocalizedError("cli.missing_id", {}, "invalid-args");
      const { restartAgentGroupContainers } = await import("../../container-restart.js");
      return restartAgentGroupContainers(args.id, "cli restart");
    },
  });
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

