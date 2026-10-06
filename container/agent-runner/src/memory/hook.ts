/**
 * memory/hook.ts —— 会话钩子机制（P1-1，与 session-hook.ts 分离）
 *
 * 职责：纯机制——注册/运行会话钩子（链式：每个钩子接收上一钩子的输出）。
 *       "机制"与"注册"分离：本文件只提供 registerSessionHook / runSessionHooks，
 *       具体的记忆注入钩子在 session-hook.ts 注册。
 * 关键导出：registerSessionHook, runSessionHooks, SessionHookContext, SessionHook, clearSessionHooksForTest
 * 借鉴：nanoclaw container/agent-runner/src/memory/hook.ts
 *
 * 修改记录：2026-10-06 创建（P1-1：钩子机制与注册分离，并把记忆钩子真正接入）
 */
export interface SessionHookContext {
  workspaceDir: string;
  systemPrompt: string;
}

export type SessionHook = (ctx: SessionHookContext) => string;

const hooks: SessionHook[] = [];

export function registerSessionHook(hook: SessionHook): void {
  hooks.push(hook);
}

/** 链式运行全部钩子：后一个钩子的输入是前一个的输出（记忆注入可叠加）。 */
export function runSessionHooks(ctx: SessionHookContext): string {
  let prompt = ctx.systemPrompt;
  for (const h of hooks) {
    prompt = h({ ...ctx, systemPrompt: prompt });
  }
  return prompt;
}

/** 仅供测试 */
export function clearSessionHooksForTest(): void {
  hooks.length = 0;
}
