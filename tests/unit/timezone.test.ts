/**
 * timezone.test.ts —— 时区工具单元测试
 *
 * 职责：IANA 校验/候选链/墙钟反解往返。
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { describe, expect, it } from "vitest";
import { formatLocalStamp, isValidTimezone, parseZonedToUtc, resolveTimezone } from "../../src/timezone.js";

describe("timezone", () => {
  it("validates IANA names", () => {
    expect(isValidTimezone("Asia/Shanghai")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });

  it("resolveTimezone falls through candidates", () => {
    expect(resolveTimezone([null, "Bad/Zone", "Asia/Tokyo"])).toBe("Asia/Tokyo");
    expect(resolveTimezone([null, "bad"])).toBeTruthy(); // 系统默认或 UTC
  });

  it("parseZonedToUtc roundtrips a wall-clock time", () => {
    const iso = "2026-08-12T02:30:00.000Z";
    // Asia/Shanghai = UTC+8 → 墙钟 10:30
    const parsed = parseZonedToUtc("2026-08-12 10:30", "Asia/Shanghai");
    expect(parsed).toBe(iso);
  });

  it("formatLocalStamp renders sv-SE shape", () => {
    expect(formatLocalStamp("2026-08-12T02:30:00.000Z", "UTC")).toBe("2026-08-12 02:30");
  });
});
