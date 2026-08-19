/**
 * smoke.test.ts —— 阶段 0 冒烟测试
 *
 * 职责：验证测试工具链（vitest）可用。
 * 修改记录：
 *   2026-08-12 创建（阶段 0）
 */
import { describe, expect, it } from "vitest";
import { main } from "../../src/index.js";

describe("phase-0 smoke", () => {
  it("exports main()", () => {
    expect(typeof main).toBe("function");
  });
});
