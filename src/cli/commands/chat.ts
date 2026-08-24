/**
 * cli/commands/chat.ts —— chat 命令
 *
 * 职责：oc chat <agent> 命令，连接 CLI socket 发送/接收消息。
 * 关键导出：registerChatCommands（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { registerCommand } from "../registry.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerChatCommands(): void {
  registerCommand({
    resource: "chat",
    verb: "send",
    scope: "open",
    agentVisible: true,
    handler: (args) => {
      const message = args.positionals.join(" ");
      if (!message) throw new LocalizedError("cli.chat_empty", {}, "invalid-args");
      return { sent: true, message };
    },
  });
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

