/**
 * guard/types.ts —— 守卫词汇表（领域无关叶子）
 *
 * 职责：actor/input/decision 类型 + Unguarded 品牌 + GuardDenyError。
 * 关键导出：GuardActor, GuardInput, GuardDecision, ALLOW, DENY, HOLD, unguarded, isUnguarded, GuardDenyError
 * 核心模式："遗漏不可表示"——注册必须二选一 guard spec 或显式 unguarded(reason)；
 *           品牌 Symbol 模块私有，unguarded() 唯一铸造点，grep "unguarded(" 即完整清单。
 * 借鉴：nanoclaw src/guard/types.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import type { PendingApproval } from "../types.js";

export type GuardActor = "host" | "agent" | "human" | "system";

export interface GuardInput {
  actor: GuardActor;
  resource?: string;
  payload?: unknown;
  /** 批准回放携带的审批行（resolve 后删行 ⇒ 恰好执行一次） */
  grant?: PendingApproval;
}

export type GuardDecision =
  | { kind: "allow"; reason: string }
  | { kind: "hold"; reason: string; approverUserId?: string }
  | { kind: "deny"; reason: string };

export const ALLOW = (reason: string): GuardDecision => ({ kind: "allow", reason });
export const DENY = (reason: string): GuardDecision => ({ kind: "deny", reason });
export const HOLD = (reason: string, approverUserId?: string): GuardDecision => ({
  kind: "hold",
  reason,
  approverUserId,
});

const UNGUARDED_BRAND: unique symbol = Symbol("openclaw.unguarded");

export interface Unguarded {
  readonly [UNGUARDED_BRAND]: true;
  readonly reason: string;
}

/** 显式声明"此动作无需守卫"（唯一铸造点） */
export function unguarded(reason: string): Unguarded {
  return { [UNGUARDED_BRAND]: true, reason };
}

export function isUnguarded(v: unknown): v is Unguarded {
  return typeof v === "object" && v !== null && (v as Record<symbol, unknown>)[UNGUARDED_BRAND] === true;
}

/** 以抛错表"设计内拒绝"，调用方可与真实故障区分（A2A 等流程使用） */
export class GuardDenyError extends Error {
  constructor(reason: string) {
    super(`guard denied: ${reason}`);
    this.name = "GuardDenyError";
  }
}
