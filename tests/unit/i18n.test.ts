/**
 * i18n.test.ts —— 宿主侧 i18n 运行时测试
 *
 * 职责：t() 插值/回退；locale env 解析；Accept-Language 协商；LocalizedError；三语 key 一致性 lint。
 *
 * 修改记录：2026-08-13 创建（阶段 14）
 */
import { describe, expect, it } from "vitest";
import {
  t,
  resolveLocaleFromEnv,
  negotiateLocale,
  isLocale,
  LocalizedError,
  isLocalizedError,
  CATALOG,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from "../../src/i18n/index.js";
import { gateCommand } from "../../src/command-gate.js";

describe("t()", () => {
  it("looks up and interpolates {param}", () => {
    expect(t("cli.not_found", "en", { id: "abc" })).toBe("not found: abc");
    expect(t("cli.not_found", "zh", { id: "abc" })).toBe("未找到：abc");
    expect(t("channel.admin_required", "ja", { cmd: "/restart" })).toBe("/restart には管理者権限が必要です");
  });

  it("falls back to key when key missing (never throws)", () => {
    expect(t("nope.missing", "en")).toBe("nope.missing");
  });

  it("keeps unmatched placeholder verbatim", () => {
    expect(t("cli.not_found", "en")).toBe("not found: {id}");
  });

  it("defaults locale to DEFAULT_LOCALE", () => {
    expect(t("common.approve")).toBe(CATALOG[DEFAULT_LOCALE]["common.approve"]);
  });
});

describe("resolveLocaleFromEnv", () => {
  it("reads OC_LOCALE when valid", () => {
    expect(resolveLocaleFromEnv({ OC_LOCALE: "ja" }, "")).toBe("ja");
    expect(resolveLocaleFromEnv({ OC_LOCALE: "en" }, "")).toBe("en");
  });
  it("falls back on invalid/missing (isolated from ambient .env)", () => {
    expect(resolveLocaleFromEnv({ OC_LOCALE: "fr" }, "")).toBe(DEFAULT_LOCALE);
    expect(resolveLocaleFromEnv({}, "")).toBe(DEFAULT_LOCALE);
  });
  it("env param takes precedence over config layer; config used when env absent", () => {
    expect(resolveLocaleFromEnv({ OC_LOCALE: "en" }, "ja")).toBe("en");
    expect(resolveLocaleFromEnv({}, "ja")).toBe("ja");
    expect(resolveLocaleFromEnv({}, "fr")).toBe(DEFAULT_LOCALE);
  });
});

describe("negotiateLocale (Accept-Language)", () => {
  it("picks highest-q supported primary tag", () => {
    expect(negotiateLocale("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(negotiateLocale("en-US,en;q=0.9,zh;q=0.8")).toBe("en");
    expect(negotiateLocale("ja-JP,ja;q=0.9")).toBe("ja");
  });
  it("skips unsupported and falls back", () => {
    expect(negotiateLocale("fr-FR,de;q=0.9", "en")).toBe("en");
    expect(negotiateLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("")).toBe(DEFAULT_LOCALE);
  });
  it("respects q ordering over document order", () => {
    expect(negotiateLocale("fr;q=0.9, ja;q=0.95")).toBe("ja");
  });
});

describe("LocalizedError", () => {
  it("carries key/params/code and is detectable", () => {
    const e = new LocalizedError("cli.not_found", { id: "x" }, "not-found");
    expect(isLocalizedError(e)).toBe(true);
    expect(e.key).toBe("cli.not_found");
    expect(e.code).toBe("not-found");
    expect(e.message).toBe("not found: x"); // 英文目录兜底，locale 无关
    expect(t(e.key, "zh", e.params)).toBe("未找到：x");
  });
  it("plain Error is not localized", () => {
    expect(isLocalizedError(new Error("x"))).toBe(false);
  });
});

describe("catalog consistency lint", () => {
  it("all locales share identical key sets", () => {
    const ref = Object.keys(CATALOG[SUPPORTED_LOCALES[0] ?? DEFAULT_LOCALE]).sort();
    for (const loc of SUPPORTED_LOCALES) {
      expect(Object.keys(CATALOG[loc]).sort()).toEqual(ref);
    }
  });
  it("no empty values", () => {
    for (const loc of SUPPORTED_LOCALES) {
      for (const [k, v] of Object.entries(CATALOG[loc])) {
        expect(v.length, `${loc}:${k}`).toBeGreaterThan(0);
      }
    }
  });
  it("isLocale guards", () => {
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe("channel wiring（阶段 14）", () => {
  it("gateCommand deny 携带 reasonKey/params，英文 reason 保留供审计", () => {
    const r = gateCommand("/restart", null, "g1");
    expect(r.action).toBe("deny");
    if (r.action === "deny") {
      expect(r.reason).toBe("admin privilege required for /restart");
      expect(r.reasonKey).toBe("channel.admin_required");
      expect(r.params).toEqual({ cmd: "/restart" });
    }
  });

  it("渠道拒绝回复可按 locale 组合本地化", () => {
    const r = gateCommand("/restart", null, "g1");
    if (r.action !== "deny") throw new Error("expected deny");
    const inner = t(r.reasonKey as string, "zh", r.params);
    expect(inner).toBe("执行 /restart 需要管理员权限");
    expect(t("channel.command_denied", "zh", { reason: inner })).toBe("命令被拒绝：执行 /restart 需要管理员权限");
    const innerJa = t(r.reasonKey as string, "ja", r.params);
    expect(t("channel.command_denied", "ja", { reason: innerJa })).toBe(
      "コマンドが拒否されました：/restart には管理者権限が必要です",
    );
  });

  it("LocalizedError 经 dispatch 语义：code 保留、文案随 locale 变", () => {
    const e = new LocalizedError("cli.name_folder_required", {}, "invalid-args");
    expect(e.code).toBe("invalid-args");
    expect(t(e.key, "en")).toBe("--name and --folder required");
    expect(t(e.key, "ja")).toBe("--name と --folder が必要です");
  });
});
