/**
 * cli/help-render.ts -- Pure renderers for command help text.
 *
 * Responsibility: three help layers that must never disagree (design report 2.3):
 *   layer 1 resource -- `oc help`, `oc <resource>`: list resources and their verbs
 *   layer 2 verb     -- `oc <resource> help`, `oc <resource> <verb> --help`
 *   layer 3 field    -- each flag with required/default/enum constraints
 * Single source for the help command, `--help` interception, and the usage block
 * appended to invalid-args errors.
 *
 * Key exports: renderCommandList, renderResourceHelp, renderVerbHelp, usageLine,
 *              flagName, listVerbs, indent, summaryLine
 * Invariant: pure functions over CommandDef[]; no I/O, no registry mutation.
 * Referenced: nanoclaw src/cli/help-render.ts
 *
 * Modification record:
 *   2026-10-04  Created (P2-14: CLI file splitting)
 *   2026-10-05  Rewritten: real three-layer help (resource/verb/field) + usageLine
 */
import type { CommandDef, FlagDef } from "./registry.js";
import { displayWidth, padEndWidth } from "../display-width.js";

export function flagName(name: string): string {
  return `--${name.replace(/_/g, "-")}`;
}

/** First line of a possibly multi-paragraph description. */
export function summaryLine(description: string): string {
  return description.split("\n", 1)[0] ?? "";
}

/** Indent every non-empty line of a block by `pad`. */
export function indent(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => (l ? pad + l : l))
    .join("\n");
}

/** All verbs a resource exposes, sorted. */
export function listVerbs(commands: CommandDef[], resource: string): string[] {
  return commands
    .filter((c) => c.resource === resource)
    .map((c) => c.verb)
    .sort((a, b) => a.localeCompare(b));
}

/** Usage line for one command, e.g. `oc groups create --name <v> --folder <v>`. */
export function usageLine(cmd: CommandDef): string {
  const needsId = cmd.flags?.some((f) => f.name === "id") ?? false;
  const parts = [`oc ${cmd.resource} ${cmd.verb}`];
  if (needsId) parts.push("<id>");
  for (const f of cmd.flags ?? []) {
    if (f.name === "id") continue;
    parts.push(f.required ? `${flagName(f.name)} <value>` : `[${flagName(f.name)} <value>]`);
  }
  return parts.join(" ");
}

function flagLine(f: FlagDef): string {
  const tags: string[] = [];
  if (f.required) tags.push("required");
  if (f.default !== undefined && f.default !== null) tags.push(`default: ${f.default}`);
  if (f.enum && f.enum.length > 0) tags.push(`values: ${f.enum.join(" | ")}`);
  const tagStr = tags.length > 0 ? ` (${tags.join(", ")})` : "";
  const desc = f.description ? ` ${summaryLine(f.description)}` : "";
  return `  ${padEndWidth(flagName(f.name), 24)}${desc}${tagStr}`;
}

/**
 * Layer 1: top-level listing. One line per resource with its verbs, plus a
 * pointer to the deeper layers so the user can drill down.
 */
export function renderCommandList(commands: CommandDef[]): string {
  const grouped = new Map<string, string[]>();
  for (const c of commands) {
    const verbs = grouped.get(c.resource) ?? [];
    if (!verbs.includes(c.verb)) verbs.push(c.verb);
    grouped.set(c.resource, verbs);
  }
  const width = Math.max(0, ...[...grouped.keys()].map((r) => displayWidth(r)));
  const listing = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([r, vs]) => `  ${padEndWidth(r, width)}  ${vs.sort((a, b) => a.localeCompare(b)).join(", ")}`)
    .join("\n");
  return [
    "OC CLI",
    "",
    "usage: oc <resource> <verb> [id] [--flags]",
    "",
    "Resources:",
    listing,
    "",
    "Drill down:",
    "  oc <resource>              list verbs for one resource",
    "  oc <resource> <verb> --help  flags and constraints for one verb",
  ].join("\n");
}

/**
 * Layer 1b: one resource. Lists its verbs with scope and description so the
 * user can pick the right one without guessing.
 */
export function renderResourceHelp(commands: CommandDef[], resource: string): string {
  const rows = commands.filter((c) => c.resource === resource);
  if (rows.length === 0) return `no commands registered for resource: ${resource}`;
  const sorted = [...rows].sort((a, b) => a.verb.localeCompare(b.verb));
  const width = Math.max(...sorted.map((c) => displayWidth(c.verb)));
  const lines = sorted.map((c) => {
    const scope = c.scope === "open" ? "" : ` [${c.scope}]`;
    const desc = c.description ? `  ${summaryLine(c.description)}` : "";
    return `  ${padEndWidth(c.verb, width)}${scope}${desc}`;
  });
  return [
    `oc ${resource}`,
    "",
    "Verbs:",
    ...lines,
    "",
    `Run \`oc ${resource} <verb> --help\` for flags and constraints.`,
  ].join("\n");
}

/**
 * Layer 2 + 3: one verb. Usage line, description, scope, then every declared
 * flag with its constraints. Falls back to a generic hint when the command
 * declares no flags.
 */
export function renderVerbHelp(cmd: CommandDef): string {
  const lines: string[] = [];
  lines.push(usageLine(cmd));
  lines.push("");
  if (cmd.description) {
    lines.push(cmd.description);
    lines.push("");
  }
  const scopeTag = cmd.scope === "open" ? "open" : cmd.scope;
  const agentTag = cmd.agentVisible ? ", agent-visible" : "";
  lines.push(`scope: ${scopeTag}${agentTag}`);

  const flags = cmd.flags ?? [];
  if (flags.length > 0) {
    lines.push("");
    lines.push("Flags:");
    for (const f of flags) lines.push(flagLine(f));
  } else {
    lines.push("");
    lines.push("Flags: none declared; pass --key value or --flag as the handler expects.");
  }
  return lines.join("\n");
}

/**
 * Usage block appended to invalid-args errors, so a rejected command carries
 * its own fix instead of a bare message.
 */
export function renderUsage(cmd: CommandDef | undefined, resource: string, verb: string): string {
  if (!cmd) return `usage: oc ${resource} ${verb} [id] [--flags]`;
  const lines = [`usage: ${usageLine(cmd)}`];
  const flags = cmd.flags ?? [];
  if (flags.length > 0) {
    lines.push("flags:");
    for (const f of flags) lines.push(flagLine(f));
  }
  return lines.join("\n");
}

/**
 * Unknown-command message that carries its fix: when the resource is known,
 * list its verbs; otherwise point at the top-level help.
 */
export function unknownCommandMessage(commands: CommandDef[], resource: string, verb: string): string {
  const verbs = listVerbs(commands, resource);
  if (verbs.length > 0) {
    return (
      `no command "${resource} ${verb}" -- verbs for ${resource}: ${verbs.join(", ")}. ` +
      `Run \`oc ${resource} ${verb} --help\` for flags.`
    );
  }
  return `no command "${resource} ${verb}". Run \`oc help\` for the resource list.`;
}

/*
 * Modification record:
 *   2026-10-04  Created (P2-14: CLI file splitting)
 *   2026-10-05  Rewritten for real three-layer help + usage-on-invalid-args
 *   2026-10-06  P2-3: column padding via displayWidth/padEndWidth (CJK-aware)
 */
