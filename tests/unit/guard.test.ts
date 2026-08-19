/**
 * guard.test.ts —— guard 决策接缝单元测试
 *
 * 职责：品牌强制/fail-closed/grant 只满足 hold 不松动 deny/重名抛错/unguarded 品牌。
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import { describe, expect, it } from "vitest";
import {
  ALLOW,
  DENY,
  HOLD,
  defineGuardedAction,
  guard,
  isUnguarded,
  unguarded,
  GuardDenyError,
} from "../../src/guard/index.js";
import type { PendingApproval } from "../../src/types.js";

function approval(over: Partial<PendingApproval>): PendingApproval {
  return {
    id: "ap-1",
    session_id: "s",
    action: "cli_command",
    payload: "{}",
    user_id: null,
    approver_user_id: null,
    agent_group_id: null,
    status: "pending",
    title: null,
    options_json: null,
    question: null,
    created_at: "2026-08-12T00:00:00Z",
    resolved_at: null,
    ...over,
  };
}

describe("guard", () => {
  it("rejects hand-written action objects (fail-closed)", () => {
    const fake = { name: "x", spec: { decide: () => ALLOW("nope") } };
    expect(guard(fake, { actor: "agent" }).kind).toBe("deny");
    expect(guard(null, { actor: "agent" }).kind).toBe("deny");
  });

  it("decide throwing yields deny", () => {
    const a = defineGuardedAction("t-throw", {
      decide: () => {
        throw new Error("boom");
      },
    });
    expect(guard(a, { actor: "agent" }).kind).toBe("deny");
  });

  it("grant satisfies hold but never deny", () => {
    const holdAction = defineGuardedAction("t-hold", {
      decide: () => HOLD("needs approval"),
      grantActionName: "cli_command",
    });
    const denyAction = defineGuardedAction("t-deny", {
      decide: () => DENY("forbidden"),
      grantActionName: "cli_command",
    });
    const grant = approval({});
    expect(guard(holdAction, { actor: "agent", grant }).kind).toBe("allow");
    expect(guard(denyAction, { actor: "agent", grant }).kind).toBe("deny");
  });

  it("invalid grants fail closed", () => {
    const a = defineGuardedAction("t-grant-invalid", {
      decide: () => HOLD("hold"),
      grantActionName: "other_action",
    });
    expect(guard(a, { actor: "agent", grant: approval({}) }).kind).toBe("deny"); // action 名不匹配
    const resolved = defineGuardedAction("t-grant-resolved", {
      decide: () => HOLD("hold"),
      grantActionName: "cli_command",
    });
    expect(guard(resolved, { actor: "agent", grant: approval({ status: "approved" }) }).kind).toBe("deny"); // 行非 pending
  });

  it("grantCoversRequest binds payload", () => {
    const a = defineGuardedAction("t-covers", {
      decide: () => HOLD("hold"),
      grantActionName: "cli_command",
      grantCoversRequest: (grantPayload, input) => grantPayload === input.payload,
    });
    const grant = approval({ payload: "same" });
    expect(guard(a, { actor: "agent", payload: "same", grant }).kind).toBe("allow");
    expect(guard(a, { actor: "agent", payload: "different", grant }).kind).toBe("deny");
  });

  it("duplicate action names throw", () => {
    defineGuardedAction("t-dup", { decide: () => ALLOW("ok") });
    expect(() => defineGuardedAction("t-dup", { decide: () => ALLOW("ok") })).toThrow(/duplicate/);
  });

  it("unguarded brand is unique and detectable", () => {
    expect(isUnguarded(unguarded("reason"))).toBe(true);
    expect(isUnguarded({ reason: "fake" })).toBe(false);
    expect(new GuardDenyError("x").name).toBe("GuardDenyError");
  });
});
