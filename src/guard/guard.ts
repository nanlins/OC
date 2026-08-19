/**
 * guard/guard.ts —— 唯一决策函数 guard(action, input)
 *
 * 职责：fail-closed 决策 + grant 语义。
 * 关键导出：guard
 * 承重不变量：
 *   - 非 defineGuardedAction 铸造的值 → DENY；decide 抛异常 → DENY；
 *   - grant 只能满足 hold，【永不】松动 deny（结构检查每次回放重跑 ⇒ "批准后撤销"不执行）；
 *   - grant 无效（action 名不匹配/行非 pending/领域绑定失败）→ fail-closed deny（不发第二张卡）。
 * 借鉴：nanoclaw src/guard/guard.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import { isGuardedAction, type GuardedAction } from "./guard-actions.js";
import { DENY, ALLOW, type GuardDecision, type GuardInput } from "./types.js";
import type { PendingApproval } from "../types.js";

/** grant 活行复核器（approvals 注册：查库验 pending，伪造内存对象不得通过，阶段 6 复检 P1 修复） */
export type GrantLiveValidator = (grant: PendingApproval) => boolean;
let grantLiveValidator: GrantLiveValidator | null = null;
export function setGrantLiveValidator(fn: GrantLiveValidator): void {
  grantLiveValidator = fn;
}

export function guard(action: unknown, input: GuardInput): GuardDecision {
  if (!isGuardedAction(action)) return DENY("unknown guarded action (fail-closed)");
  const a: GuardedAction = action;

  let decision: GuardDecision;
  try {
    decision = a.spec.decide(input);
  } catch {
    return DENY(`${a.name}: decide threw (fail-closed)`);
  }

  if (decision.kind === "deny") return decision; // grant 永不松动 deny

  if (decision.kind === "hold") {
    const grant = input.grant;
    if (!grant) return decision;
    // grant 有效性：action 名匹配 + 行仍 live（resolve 会删行 ⇒ 恰好执行一次）
    if (a.spec.grantActionName !== grant.action) return DENY(`${a.name}: grant action mismatch (fail-closed)`);
    if (grant.status !== "pending") return DENY(`${a.name}: grant row not live (fail-closed)`);
    if (grantLiveValidator && !grantLiveValidator(grant)) {
      return DENY(`${a.name}: grant row failed DB live-check (fail-closed)`);
    }
    if (a.spec.grantCoversRequest && !a.spec.grantCoversRequest(grant.payload, input)) {
      return DENY(`${a.name}: grant does not cover request (fail-closed)`);
    }
    return ALLOW(`${a.name}: approved via grant ${grant.id}`);
  }

  return decision;
}
