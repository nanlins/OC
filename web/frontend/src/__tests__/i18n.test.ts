/**
 * __tests__/i18n.test.ts —— i18n 测试（三语切换 + cycleLocale + key 一致性 lint）
 *
 * 关键导出：无（vitest 测试套件）
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 11）
 *   2026-08-13 阶段 14：扩展 zh/en/ja 三语 + cycleLocale + 目录 key 一致性 lint
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { setLocale, cycleLocale, useT, LOCALES, __dictForTest } from "../i18n/index.js";
import { actions } from "../store/app-store.js";

afterEach(() => {
  cleanup();
  actions.stop();
  vi.unstubAllGlobals();
});

describe("i18n useT", () => {
  it("setLocale('en') 后返回英文", () => {
    setLocale("en");
    const { result } = renderHook(() => useT());
    expect(result.current("nav.sessions")).toBe("Sessions");
    expect(result.current("approvals.approve")).toBe("Approve");
  });

  it("setLocale('zh') 后返回中文", () => {
    setLocale("zh");
    const { result } = renderHook(() => useT());
    expect(result.current("nav.sessions")).toBe("会话");
    expect(result.current("approvals.reject")).toBe("拒绝");
  });

  it("setLocale('ja') 后返回日文", () => {
    setLocale("ja");
    const { result } = renderHook(() => useT());
    expect(result.current("nav.sessions")).toBe("セッション");
    expect(result.current("approvals.approve")).toBe("承認");
  });

  it("未知 key 回退为 key 本身", () => {
    setLocale("en");
    const { result } = renderHook(() => useT());
    expect(result.current("missing.key")).toBe("missing.key");
  });
});

describe("cycleLocale", () => {
  it("三语循环 zh → en → ja → zh", () => {
    setLocale("zh");
    expect(cycleLocale()).toBe("en");
    expect(cycleLocale()).toBe("ja");
    expect(cycleLocale()).toBe("zh");
  });
});

describe("catalog consistency lint", () => {
  it("三语 key 集合一致", () => {
    const dict = __dictForTest();
    const ref = Object.keys(dict[LOCALES[0]]).sort();
    for (const loc of LOCALES) {
      expect(Object.keys(dict[loc]).sort()).toEqual(ref);
    }
  });
  it("无空值", () => {
    const dict = __dictForTest();
    for (const loc of LOCALES) {
      for (const [k, v] of Object.entries(dict[loc])) {
        expect(v.length, `${loc}:${k}`).toBeGreaterThan(0);
      }
    }
  });
});
