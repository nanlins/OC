/**
 * cli/dispatch.ts ?”â€?ä¼ è?? å…³?†å??? *
 * ?Œè´£ï¼šè§£??"<resource> <verb> [id] [--flags]"ï¼›å??«ï?host?’allowï¼›open?’allowï¼? *       agentï¼šcli_scope disabled?’forbidden / group?’agentVisible ?½å???/ admin çº§â?hasAdminPrivilege
 *       ?¦å? hold?’å»º 'cli_command' å®¡æ‰¹?’approval-pendingï¼›æ‰§è¡?handlerï¼›é?è¯¯ç?? å??? * ?³é”®å¯¼å‡ºï¼šdispatch, parseCmd
 * ?¿é?ä¸å??ï?è°ƒç”¨?…èº«ä»½ç”±ä¼ è??‚é??¨å¡«?…ï?å¸§ä??ºå¸¦ï¼‰ï?agent ?¢ä?æ¬¡æ”¶çª„ä? cli_scope?? * ?Ÿé‰´ï¼šnanoclaw src/cli/dispatch.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?7ï¼? *   2026-08-13 ?¶æ®µ 14ï¼šé?è¯¯æ?æ¡ˆæ¥??i18nï¼ˆlocale ?‚æ•° + LocalizedError ç¿»è?ï¼? */
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
    // actor ?½å??•ï?fail-closedï¼ŒP0 ä¿®å?ï¼?    if (caller.actor !== "host" && caller.actor !== "agent") {
      return { requestId: frame.requestId, ok: false, code: "forbidden", error: t("cli.invalid_caller", locale) };
    }
    const parsed = parseCmd(frame.cmd);
    if (!parsed) {
      return { requestId: frame.requestId, ok: false, code: "invalid-args", error: t("cli.usage", locale) };
    }
    // fix-plan CLI helpï¼šoc help ?—å‡º?€?‰æ³¨?Œå‘½ä»?    if (parsed.resource === "help") {
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

    // ---- å®ˆå« ----
    if (caller.actor === "agent") {
      const cfg = caller.agentGroupId ? getContainerConfig(caller.agentGroupId) : undefined;
      // P1 ä¿®å?ï¼šç¼º?ç½®è¡Œé?è®?groupï¼ˆåŸºçº¿é?è®¤ï?ï¼›é?æ³•é?ç©ºå€?fail-closed ä¸?disabled
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
          // å®¡æ‰¹?æ”¾ï¼šå®¡?¹å³?ˆæ?ï¼ˆç??„æ??¥ï?approved ä»…ç”± approvals resolve å¸¦å?æ³¨å…¥ï¼?        } else {
          const uid = caller.userId;
          if (!uid || !hasAdminPrivilege(uid, caller.agentGroupId ?? null)) {
            // hold ??å»ºå®¡?¹ï??¶æ®µ 6 ?­ç¯?¥å£ï¼?            const row = createPendingApproval({
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

    // ---- ?§è? ----
    const data = await def.handler(parsed.args, caller);
    return { requestId: frame.requestId, ok: true, data, human: JSON.stringify(data, null, 2) };
  } catch (err) {
    // ç»“æ??–æœ¬?°å??™è¯¯ï¼šæ?è¯·æ? locale ç¿»è?ï¼ˆé˜¶æ®?14ï¼?    if (isLocalizedError(err)) {
      const code = (
        ["invalid-args", "not-found", "forbidden"].includes(err.code) ? err.code : "handler-error"
      ) as ResponseFrame["code"];
      return { requestId: frame.requestId, ok: false, code, error: t(err.key, locale, err.params) };
    }
    // å®ˆå«æ®µå?å¸¸å??·å?åº•ï?P1 ä¿®å?ï¼šä?å¾?unhandledRejection å´©ä¸»?ºï?
    const code = (err as { code?: string }).code;
    if (code === "invalid-args" || code === "not-found" || code === "forbidden") {
      return { requestId: frame.requestId, ok: false, code, error: String(err) };
    }
    log.error(`cli dispatch error: ${frame.cmd}`, { err });
    return { requestId: frame.requestId, ok: false, code: "handler-error", error: String(err) };
  }
}
