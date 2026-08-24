/**
 * cli/commands/config.ts —— config 管理命令
 *
 * 职责：oc config show/set 命令，显示/设置容器配置。
 * 关键导出：registerConfigCommands（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { registerCommand } from "../registry.js";
import { getContainerConfig, updateContainerConfig } from "../../db/container-configs.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerConfigCommands(): void {
  registerCommand({
    resource: "config",
    verb: "show",
    scope: "agent-group",
    agentVisible: true,
    handler: (args, caller) => {
      const groupId = args.flags.group ?? caller.agentGroupId;
      if (!groupId) throw new LocalizedError("cli.group_id_required", {}, "invalid-args");
      const config = getContainerConfig(groupId);
      if (!config) throw new LocalizedError("cli.not_found", { id: groupId }, "not-found");
      return config;
    },
  });

  registerCommand({
    resource: "config",
    verb: "set",
    scope: "host",
    handler: (args) => {
      const groupId = args.flags.group;
      if (!groupId) throw new LocalizedError("cli.group_id_required", {}, "invalid-args");
      const updates: Record<string, string | null> = {};
      if (args.flags.model) updates.model = args.flags.model;
      if (args.flags.effort) updates.effort = args.flags.effort;
      if (args.flags.provider) updates.provider = args.flags.provider;
      if (Object.keys(updates).length === 0) throw new LocalizedError("cli.config_no_updates", {}, "invalid-args");
      updateContainerConfig(groupId, updates);
      return { ok: true };
    },
  });
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

