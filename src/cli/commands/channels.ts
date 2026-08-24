/**
 * cli/commands/channels.ts —— channels 管理命令
 *
 * 职责：channels add/list 命令，管理通道绑定（wiring）。
 * 关键导出：registerChannelsCommands（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { registerCommand } from "../registry.js";
import { createWiring } from "../../db/messaging-groups.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerChannelsCommands(): void {
  registerCommand({
    resource: "channels",
    verb: "add",
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
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

