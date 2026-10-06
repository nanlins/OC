/**
 * cli/registry.ts —— 命令注册表（声明即守卫）
 *
 * 职责：registerCommand({resource, verb, scope, handler})；scope: open/host/admin/agent-group；
 *       listCommands/lookup。agent 可调面由 cli_scope 在 dispatch 层二次收窄。
 * 关键导出：registerCommand, lookupCommand, listCommands, CommandDef
 * 借鉴：nanoclaw src/cli/registry.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 *   2026-10-05 增加 description/flags 元数据与 listResources/hasResource/verbsForResource（三层帮助支撑）
 */
import type { CallerContext, ResponseFrame } from "./frame.js";

export type CommandScope = "open" | "host" | "admin" | "agent-group";

/** Field-level help metadata for one flag (design report 2.3 layer 3). */
export interface FlagDef {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;
  enum?: string[];
}

export interface CommandDef {
  resource: string;
  verb: string;
  scope: CommandScope;
  /** agent 在 cli_scope=group 时是否可见（白名单） */
  agentVisible?: boolean;
  /** One-line description shown in resource/verb help layers. */
  description?: string;
  /** Declared flags; drives field-level help and usage-on-invalid-args. */
  flags?: FlagDef[];
  handler: (args: ParsedArgs, caller: CallerContext) => Promise<unknown> | unknown;
}

export interface ParsedArgs {
  id?: string;
  flags: Record<string, string>;
  positionals: string[];
}

const commands = new Map<string, CommandDef>();

function key(resource: string, verb: string): string {
  return `${resource} ${verb}`;
}

export function registerCommand(def: CommandDef): void {
  if (commands.has(key(def.resource, def.verb))) {
    throw new Error(`duplicate cli command: ${key(def.resource, def.verb)}`);
  }
  commands.set(key(def.resource, def.verb), def);
}

export function lookupCommand(resource: string, verb: string): CommandDef | undefined {
  return commands.get(key(resource, verb));
}

export function listCommands(): CommandDef[] {
  return [...commands.values()];
}

/** Distinct resource names, sorted. Drives the top-level help listing. */
export function listResources(): string[] {
  return [...new Set([...commands.values()].map((c) => c.resource))].sort((a, b) => a.localeCompare(b));
}

export function hasResource(resource: string): boolean {
  for (const c of commands.values()) {
    if (c.resource === resource) return true;
  }
  return false;
}

/** All verbs registered for one resource, sorted. */
export function verbsForResource(resource: string): string[] {
  return [...commands.values()]
    .filter((c) => c.resource === resource)
    .map((c) => c.verb)
    .sort((a, b) => a.localeCompare(b));
}

/** 仅供测试 */
export function clearCommandsForTest(): void {
  commands.clear();
}

export type { ResponseFrame };
