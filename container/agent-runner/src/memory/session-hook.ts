/**
 * memory/session-hook.ts —— 记忆会话钩子
 *
 * 职责：注册到 Provider 的 memory session hook，在会话创建/恢复时被调用。
 *       将记忆文档（memory/index.md）注入到系统提示中。
 * 关键导出：createMemorySessionHook, MemorySessionHook
 * 借鉴：nanoclaw container/agent-runner/src/memory/session-hook.ts
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface MemoryHookContext {
  workspaceDir: string;
  systemPrompt: string;
}

export type MemorySessionHook = (ctx: MemoryHookContext) => string;

export function createMemorySessionHook(): MemorySessionHook {
  return (ctx: MemoryHookContext): string => {
    const memoryPath = join(ctx.workspaceDir, "memory", "index.md");
    try {
      const memory = readFileSync(memoryPath, "utf-8").trim();
      if (memory) {
        return `${ctx.systemPrompt}\n\n<memory>\n${memory}\n</memory>`;
      }
    } catch {
      // 记忆文件不存在，返回原始系统提示
    }
    return ctx.systemPrompt;
  };
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

