/**
 * cli/dispatch.ts —— 传输无关分发器
 *
 * 职责：解析 "<resource> <verb> [id] [--flags]"；守卫：host→allow；open→allow；
 *       agent：cli_scope disabled→forbidden / group→agentVisible 白名单 / admin 级→hasAdminPrivilege
 *       否则 hold→建 'cli_command' 审批→approval-pending；执行 handler；错误码映射。
 * 关键导出：dispatch, parseCmd
 * 承重不变量：调用者身份由传输适配器填充（帧不携带）；agent 面二次收窄于 cli_scope。
 * 借鉴：nanoclaw src/cli/dispatch.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 *   2026-08-13 阶段 14：错误文案接入 i18n（locale 参数 + LocalizedError 翻译）
 */
import { lookupCommand, listCommands, type ParsedArgs } from "./registry.js";
import type { CallerContext, ResponseFrame } from "./frame.js";
import { getContainerConfig } from "../db/container-configs.js";
import { hasAdminPrivilege } from "../db/users.js";
import { createPendingApproval } from "../modules/approvals.js";
import { log } from "../log.js";
import { t, resolveLocaleFromEnv, isLocalizedError, type Locale } from "../i18n/index.js";

export function parseCmd(cmd: string): { resource: string; verb: string; args: ParsedArgs } | null {
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const [resource, verb] = tokens as [string, string];
  const args: ParsedArgs = { flags: {}, positionals: [] };
  const rest = tokens.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i] as string;
    if (t.startsWith("--")) {
      const name = t.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        args.flags[name] = next;
        i++;
      } else {
        args.flags[name] = "true";
      }
    } else if (!args.id) {
      args.id = t;
    } else {
      args.positionals.push(t);
    }
  }
  return { resource, verb, args };
}

export async function dispatch(
  frame: { cmd: string; requestId?: string },
  caller: CallerContext,
  locale: Locale = resolveLocaleFromEnv(),
): Promise<ResponseFrame> {
  try {
    // actor 白名单（fail-closed，P0 修复）
    if (caller.actor !== "host" && caller.actor !== "agent") {
      return { requestId: frame.requestId, ok: false, code: "forbidden", error: t("cli.invalid_caller", locale) };
    }
    const parsed = parseCmd(frame.cmd);
    if (!parsed) {
      return { requestId: frame.requestId, ok: false, code: "invalid-args", error: t("cli.usage", locale) };
    }
    // fix-plan CLI help：oc help 列出所有注册命令
    if (parsed.resource === "help") {
      const cmds = listCommands();
      const grouped = new Map<string, string[]>();
      for (const c of cmds) {
        const verbs = grouped.get(c.resource) ?? [];
        if (!verbs.includes(c.verb)) verbs.push(c.verb);
        grouped.set(c.resource, verbs);
      }
      const listing = [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([r, vs]) => `  ${r} ${vs.join("|")}`)
        .join("\n");
      return {
        requestId: frame.requestId,
        ok: true,
        human: `OC CLI\n${listing}`,
        data: { commands: cmds.length },
      };
    }
    const def = lookupCommand(parsed.resource, parsed.verb);
    if (!def) {
      return {
        requestId: frame.requestId,
        ok: false,
        code: "unknown-command",
        error: t("cli.unknown_command", locale, { resource: parsed.resource, verb: parsed.verb }),
      };
    }

    // ---- 守卫 ----
    if (caller.actor === "agent") {
      const cfg = caller.agentGroupId ? getContainerConfig(caller.agentGroupId) : undefined;
      // P1 修复：缺配置行默认 group（基线默认）；非法非空值 fail-closed 为 disabled
      const rawScope = cfg?.cli_scope ?? null;
      const scope =
        rawScope === null ? "group" : rawScope === "global" ? "global" : rawScope === "group" ? "group" : "disabled";
      if (scope === "disabled") {
        return { requestId: frame.requestId, ok: false, code: "forbidden", error: t("cli.scope_disabled", locale) };
      }
      if (scope === "group" && !def.agentVisible) {
        return {
          requestId: frame.requestId,
          ok: false,
          code: "forbidden",
          error: t("cli.not_in_group_scope", locale, { cmd: frame.cmd }),
        };
      }
      if (def.scope === "admin" || def.scope === "host") {
        if (caller.approved) {
          // 审批重放：审批即授权（结构检查：approved 仅由 approvals resolve 带外注入）
        } else {
          const uid = caller.userId;
          if (!uid || !hasAdminPrivilege(uid, caller.agentGroupId ?? null)) {
            // hold → 建审批（阶段 6 闭环入口）
            const row = createPendingApproval({
              sessionId: "cli-dispatch",
              action: "cli_command",
              agentGroupId: caller.agentGroupId,
              payload: { cmd: frame.cmd, caller },
              title: t("cli.approval_title", locale, { cmd: frame.cmd }),
            });
            log.info(`cli command held for approval: ${frame.cmd} (${row.id})`);
            return {
              requestId: frame.requestId,
              ok: false,
              code: "approval-pending",
              error: row.id,
              data: { approval_id: row.id },
            };
          }
        }
      }
    }

    // ---- 执行 ----
    const data = await def.handler(parsed.args, caller);
    return { requestId: frame.requestId, ok: true, data, human: JSON.stringify(data, null, 2) };
  } catch (err) {
    // 结构化本地化错误：按请求 locale 翻译（阶段 14）
    if (isLocalizedError(err)) {
      const code = (
        ["invalid-args", "not-found", "forbidden"].includes(err.code) ? err.code : "handler-error"
      ) as ResponseFrame["code"];
      return { requestId: frame.requestId, ok: false, code, error: t(err.key, locale, err.params) };
    }
    // 守卫段异常同样兜底（P1 修复：不得 unhandledRejection 崩主机）
    const code = (err as { code?: string }).code;
    if (code === "invalid-args" || code === "not-found" || code === "forbidden") {
      return { requestId: frame.requestId, ok: false, code, error: String(err) };
    }
    log.error(`cli dispatch error: ${frame.cmd}`, { err });
    return { requestId: frame.requestId, ok: false, code: "handler-error", error: String(err) };
  }
}
