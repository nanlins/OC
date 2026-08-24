/**
 * cli/commands/groups.ts —— groups 管理命令
 *
 * 职责：groups restart 命令（create 已在 resources.ts 中注册）。
 * 关键导出：registerGroupsCommands（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { registerCommand } from "../registry.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerGroupsCommands(): void {
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