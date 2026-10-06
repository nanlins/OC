/**
 * memory/session-hook.ts —— 记忆会话钩子注册（P1-1）
 *
 * 职责：把"记忆注入系统提示"注册为会话钩子（经 hook.ts 机制）。
 *       旧实现（2026-08-24）是死代码：createMemorySessionHook 从未被任何模块导入。
 *       现在经副作用注册真正接入 provider 生命周期（index.ts 的 systemPrompt 工厂
 *       每轮运行 runSessionHooks），provider-contracts 据此声明
 *       lifecycle.memorySessionHookRegistration=true。
 * 关键导出：createMemorySessionHook（副作用注册）
 * 借鉴：nanoclaw container/agent-runner/src/memory/session-hook.ts
 *
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单；但从未接入——死代码）
 *   2026-10-06 P1-1：经 hook.ts 注册，真正接入；渲染委托 context.ts（OKF v0.1）
 */
import { registerSessionHook } from "./hook.ts";
import { renderMemorySection } from "./context.ts";

export interface MemoryHookContext {
  workspaceDir: string;
  systemPrompt: string;
}

export type MemorySessionHook = (ctx: MemoryHookContext) => string;

/** 记忆注入钩子：把 OKF v0.1 记忆块追加到系统提示（记忆文件缺失时原样返回）。 */
export function createMemorySessionHook(): MemorySessionHook {
  return (ctx: MemoryHookContext): string => {
    const section = renderMemorySection();
    if (!section) return ctx.systemPrompt;
    return `${ctx.systemPrompt}\n\n${section}`;
  };
}

// 副作用注册（阶段 4 的 provider 生命周期经 index.ts 的 systemPrompt 工厂每轮运行）
registerSessionHook(createMemorySessionHook());
