/**
 * cli/commands/sessions.ts —— sessions 管理命令
 *
 * 职责：sessions clear 命令。
 * 关键导出：registerSessionsCommands（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { registerCommand } from "../registry.js";
import { getSession } from "../../db/sessions.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerSessionsCommands(): void {
  registerCommand({
    resource: "sessions",
    verb: "clear",
    scope: "host",
    handler: (args) => {
      if (!args.id) throw new LocalizedError("cli.missing_id", {}, "invalid-args");
      const session = getSession(args.id);
      if (!session) throw new LocalizedError("cli.not_found", { id: args.id }, "not-found");
      return { cleared: true, sessionId: args.id };
    },
  });
}

/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */
