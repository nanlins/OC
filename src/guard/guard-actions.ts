/**
 * guard/guard-actions.ts —— 特权动作目录（品牌化动作值）
 *
 * 职责：defineGuardedAction 铸造带品牌的 GuardedAction；重名即抛错；WeakSet 运行时兜底。
 * 关键导出：defineGuardedAction, isGuardedAction, listGuardedActions, GuardedAction, GuardedActionSpec
 * 核心模式：手写 {action, decide} 对象既过不了编译也过不了运行时（fail-closed）；
 *           名字是 grant 匹配键；咨询携带值而非名字（拼错是编译错误）。
 * 借鉴：nanoclaw src/guard/guard-actions.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import type { GuardDecision, GuardInput } from "./types.js";

export interface GuardedActionSpec {
  /** 唯一 allow 来源 */
  decide: (input: GuardInput) => GuardDecision;
  /** hold 经哪个 pending_approvals.action 解决 */
  grantActionName?: string;
  /** grant 与请求的额外领域绑定（结构检查每次回放重跑） */
  grantCoversRequest?: (grantPayload: unknown, input: GuardInput) => boolean;
}

const BRAND: unique symbol = Symbol("openclaw.guarded-action");

export interface GuardedAction {
  readonly [BRAND]: true;
  readonly name: string;
  readonly spec: GuardedActionSpec;
}

const known = new WeakSet<object>();
const all: GuardedAction[] = [];

export function defineGuardedAction(name: string, spec: GuardedActionSpec): GuardedAction {
  if (all.some((a) => a.name === name)) throw new Error(`duplicate guarded action: ${name}`);
  const action: GuardedAction = { [BRAND]: true, name, spec };
  known.add(action);
  all.push(action);
  return action;
}

/** 运行时兜底：手写对象过不了 */
export function isGuardedAction(v: unknown): v is GuardedAction {
  return typeof v === "object" && v !== null && known.has(v);
}

export function listGuardedActions(): readonly GuardedAction[] {
  return all;
}

/** 仅供测试 */
export function clearGuardedActionsForTest(): void {
  all.length = 0;
}
