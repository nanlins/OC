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
 */
import type { CallerContext, ResponseFrame } from "./frame.js";

export type CommandScope = "open" | "host" | "admin" | "agent-group";

export interface CommandDef {
  resource: string;
  verb: string;
  scope: CommandScope;
  /** agent 在 cli_scope=group 时是否可见（白名单） */
  agentVisible?: boolean;
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

/** 仅供测试 */
export function clearCommandsForTest(): void {
  commands.clear();
}

export type { ResponseFrame };
