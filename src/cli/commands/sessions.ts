/**
 * cli/commands/sessions.ts —— sessions 管理命令
 *
 * 职责：sessions clear 命令——真正清空该会话的容器侧上下文（不是只回 {cleared:true}）。
 * 关键导出：registerSessionsCommands（副作用注册）
 * 承重不变量：清空范围由 session-manager.clearSessionContext 单点定义（/new 共用同一语义），
 *             此处不得自行拼 SQL，否则两处语义会漂移。
 * 借鉴：nanoclaw src/cli/resources/
 *
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 *   2026-10-06 P0-1：修掉假实现——原先只 getSession 后返回 {cleared:true}，不清任何状态；
 *              改为调用 clearSessionContext 并回报实际删除的键数
 */
import { registerCommand } from "../registry.js";
import { getSession } from "../../db/sessions.js";
import { clearSessionContext } from "../../session-manager.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerSessionsCommands(): void {
  registerCommand({
    resource: "sessions",
    verb: "clear",
    scope: "host",
    description:
      "Clear a session's agent context (history/continuation/todos). " +
      "Keeps messages_in, delivery bookkeeping, destinations and undelivered replies.",
    flags: [{ name: "id", description: "Session id.", required: true }],
    handler: (args) => {
      if (!args.id) throw new LocalizedError("cli.missing_id", {}, "invalid-args");
      const session = getSession(args.id);
      if (!session) throw new LocalizedError("cli.not_found", { id: args.id }, "not-found");
      const clearedKeys = clearSessionContext(session);
      return { cleared: true, sessionId: session.id, clearedKeys };
    },
  });
}

/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 *   2026-10-06 P0-1：接入 clearSessionContext，返回真实 clearedKeys
 */
