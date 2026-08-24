/**
 * cli/commands/index.ts —— commands barrel
 *
 * 职责：副作用导入全部命令注册函数。
 * 关键导出：registerAllCommands
 * 借鉴：nanoclaw src/cli/resources/
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { registerGroupsCommands } from "./groups.js";
import { registerChannelsCommands } from "./channels.js";
import { registerSessionsCommands } from "./sessions.js";
import { registerTasksCommands } from "./tasks.js";
import { registerChatCommands } from "./chat.js";
import { registerConfigCommands } from "./config.js";

let registered = false;

export function registerAllCommands(): void {
  if (registered) return;
  registered = true;
  registerGroupsCommands();
  registerChannelsCommands();
  registerSessionsCommands();
  registerTasksCommands();
  registerChatCommands();
  registerConfigCommands();
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

