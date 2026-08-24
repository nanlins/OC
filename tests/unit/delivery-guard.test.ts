/**
 * delivery-guard.test.ts —— 投递守卫单元测试
 *
 * 职责：验证 delivery-guard.ts 的 guard 咨询管线（allow/hold/deny）。
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { defineGuardedAction, ALLOW, HOLD, DENY, isUnguarded } from "../../src/guard/index.js";
import { setupTestDb, closeTestDb } from "../fixtures/memory-db.js";

beforeEach(() => {
  setupTestDb();
});

afterEach(() => {
  closeTestDb();
});

describe("delivery-guard", () => {
  it("ALLOW passes", () => {
    const action = defineGuardedAction("test.allow", {
      decide: () => ALLOW("ok"),
      grantActionName: "test.allow",
    });
    expect(action.spec.decide({ actor: "agent" })).toEqual({ kind: "allow", reason: "ok" });
  });

  it("HOLD returns hold", () => {
    const action = defineGuardedAction("test.hold", {
      decide: () => HOLD("needs approval"),
      grantActionName: "test.hold",
    });
    expect(action.spec.decide({ actor: "agent" })).toEqual({ kind: "hold", reason: "needs approval" });
  });

  it("DENY returns deny", () => {
    const action = defineGuardedAction("test.deny", {
      decide: () => DENY("not allowed"),
      grantActionName: "test.deny",
    });
    expect(action.spec.decide({ actor: "agent" })).toEqual({ kind: "deny", reason: "not allowed" });
  });

  it("isUnguarded returns false for plain objects", () => {
    expect(isUnguarded({ reason: "x" })).toBe(false);
  });
});
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

