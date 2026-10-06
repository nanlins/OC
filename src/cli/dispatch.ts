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
 *   2026-10-04 P0-3：human 输出改用 format.ts 表格渲染替代 JSON.stringify
 *   2026-10-05 修复 oc help 死代码：parseCmd 放开单 token（verb=""），补三层帮助拦截
 *              （oc help / oc help <res> / oc <res> / oc <res> help / --help）；
 *              --help 拦截置于 agent deny 之后、hold 之前（问帮助不生成审批卡）；
 *              invalid-args 错误附加 usage；unknown-command 列出该资源可用动词
 */
import { lookupCommand, listCommands, hasResource, type CommandDef, type ParsedArgs } from "./registry.js";
import type { CallerContext, ResponseFrame } from "./frame.js";
import { getContainerConfig } from "../db/container-configs.js";
import { hasAdminPrivilege } from "../db/users.js";
import { createPendingApproval } from "../modules/approvals.js";
import { log } from "../log.js";
import { t, resolveLocaleFromEnv, isLocalizedError, type Locale } from "../i18n/index.js";
import { formatHuman } from "./format.js";
import {
  renderCommandList,
  renderResourceHelp,
  renderVerbHelp,
  renderUsage,
  unknownCommandMessage,
} from "./help-render.js";

/**
 * Parse "<resource> <verb> [id] [--flags]".
 *
 * A single token is legal and yields verb "" -- that is the resource-level help
 * entry point (`oc groups`). Previously this returned null, which made the
 * `resource === "help"` branch below unreachable dead code: `oc help` died on
 * the invalid-args guard before it could ever render the command list.
 * Only a completely empty command returns null.
 */
export function parseCmd(cmd: string): { resource: string; verb: string; args: ParsedArgs } | null {
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 1) return null;
  const resource = tokens[0] as string;
  const verb = (tokens[1] ?? "") as string;
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

function ok(requestId: string | undefined, human: string, data: unknown): ResponseFrame {
  return { requestId, ok: true, data, human };
}

export async function dispatch(
  frame: { cmd: string; requestId?: string },
  caller: CallerContext,
  locale: Locale = resolveLocaleFromEnv(),
): Promise<ResponseFrame> {
  // 解析出的命令定义提到 try 外：catch 段用它给 invalid-args 附上 usage（错误自带修法）
  let resolved: CommandDef | undefined;
  let resolvedResource = "";
  let resolvedVerb = "";
  try {
    // actor 白名单（fail-closed，P0 修复）
    if (caller.actor !== "host" && caller.actor !== "agent") {
      return { requestId: frame.requestId, ok: false, code: "forbidden", error: t("cli.invalid_caller", locale) };
    }
    const parsed = parseCmd(frame.cmd);
    if (!parsed) {
      return { requestId: frame.requestId, ok: false, code: "invalid-args", error: t("cli.usage", locale) };
    }
    const cmds = listCommands();

    // ---- 帮助层 1：oc help / oc help <resource> ----
    if (parsed.resource === "help") {
      const target = parsed.verb || parsed.args.id;
      if (target && hasResource(target)) {
        return ok(frame.requestId, renderResourceHelp(cmds, target), { resource: target });
      }
      return ok(frame.requestId, renderCommandList(cmds), { commands: cmds.length });
    }

    // ---- 帮助层 1b：oc <resource> / oc <resource> help ----
    if (!parsed.verb || parsed.verb === "help") {
      if (!hasResource(parsed.resource)) {
        return {
          requestId: frame.requestId,
          ok: false,
          code: "unknown-command",
          error: unknownCommandMessage(cmds, parsed.resource, parsed.verb || "(none)"),
        };
      }
      return ok(frame.requestId, renderResourceHelp(cmds, parsed.resource), {
        resource: parsed.resource,
      });
    }

    const def = lookupCommand(parsed.resource, parsed.verb);
    if (!def) {
      return {
        requestId: frame.requestId,
        ok: false,
        code: "unknown-command",
        error: unknownCommandMessage(cmds, parsed.resource, parsed.verb),
      };
    }
    resolved = def;
    resolvedResource = parsed.resource;
    resolvedVerb = parsed.verb;

    // ---- 守卫：deny 段 ----
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
    }

    // ---- 帮助层 2/3：--help 拦截 ----
    // 位置承重：必须在 agent deny 之后（group 面不得借 --help 探测越权资源），
    // 且在 hold 之前——对审批级动词问帮助绝不能生成审批卡（对齐 nanoclaw dispatch）。
    if (parsed.args.flags.help === "true") {
      return ok(frame.requestId, renderVerbHelp(def), { resource: def.resource, verb: def.verb });
    }

    // ---- 守卫：hold 段 ----
    if (caller.actor === "agent" && (def.scope === "admin" || def.scope === "host")) {
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

    // ---- 执行 ----
    const data = await def.handler(parsed.args, caller);
    return { requestId: frame.requestId, ok: true, data, human: formatHuman(data) };
  } catch (err) {
    // invalid-args 自带 usage：被拒的命令携带自己的修法，而不是只给一句报错
    const withUsage = (msg: string, code: string | undefined): string =>
      code === "invalid-args" ? `${msg}\n${renderUsage(resolved, resolvedResource, resolvedVerb)}` : msg;

    // 结构化本地化错误：按请求 locale 翻译（阶段 14）
    if (isLocalizedError(err)) {
      const code = (
        ["invalid-args", "not-found", "forbidden"].includes(err.code) ? err.code : "handler-error"
      ) as ResponseFrame["code"];
      return {
        requestId: frame.requestId,
        ok: false,
        code,
        error: withUsage(t(err.key, locale, err.params), code),
      };
    }
    // 守卫段异常同样兜底（P1 修复：不得 unhandledRejection 崩主机）
    const code = (err as { code?: string }).code;
    if (code === "invalid-args" || code === "not-found" || code === "forbidden") {
      return { requestId: frame.requestId, ok: false, code, error: withUsage(String(err), code) };
    }
    log.error(`cli dispatch error: ${frame.cmd}`, { err });
    return { requestId: frame.requestId, ok: false, code: "handler-error", error: String(err) };
  }
}
