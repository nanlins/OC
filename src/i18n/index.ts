/**
 * i18n/index.ts —— 宿主侧多语运行时
 *
 * 职责：t() 查表+{param} 插值+回退；locale 解析（env / Accept-Language 协商）；
 *       LocalizedError 结构化错误（handler 抛出，渲染缝隙按请求 locale 翻译）。
 * 关键导出：t, resolveLocaleFromEnv, negotiateLocale, isLocale, LocalizedError, isLocalizedError
 * 承重不变量：
 *   1. t() 缺 key/缺 locale 一律回退（返回 key 本身），绝不抛错——i18n 不得成为故障源；
 *   2. negotiateLocale 仅接受 SUPPORTED_LOCALES 内值，非法/缺失回退 DEFAULT_LOCALE；
 *   3. LocalizedError 携带稳定 code（映射 ResponseFrame.code），翻译只改文案不改语义。
 *
 * 修改记录：2026-08-13 创建（阶段 14）；同日 resolveLocaleFromEnv 接入 config.OC_LOCALE（P1-1 修复）
 *   2026-08-14 fix-plan P2：resolveLocaleFromEnv 改显式入参优先 + configLocale 参数化，修复 .env 污染测试
 */
import { CATALOG, DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "./catalog.js";
import { OC_LOCALE } from "../config.js";

export type { Locale } from "./catalog.js";
export { CATALOG, DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./catalog.js";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

/** 查表 + {param} 插值；缺 key 回退 key 本身，缺占位符值保留原样 */
export function t(key: string, locale: Locale = DEFAULT_LOCALE, params?: Record<string, string | number>): string {
  const table = CATALOG[locale] ?? CATALOG[DEFAULT_LOCALE];
  let out = table[key] ?? CATALOG[DEFAULT_LOCALE][key] ?? key;
  if (params) {
    out = out.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
  }
  return out;
}

/** 解析 locale：显式入参 env.OC_LOCALE 优先（可测试/可按请求覆盖），其次 .env 配置 configLocale（默认 config.OC_LOCALE），回退 DEFAULT_LOCALE。
 * configLocale 参数化以便测试隔离环境 .env（fix-plan P2：任何本地环境全绿）。 */
export function resolveLocaleFromEnv(env: NodeJS.ProcessEnv = process.env, configLocale: string = OC_LOCALE): Locale {
  const raw = env.OC_LOCALE || configLocale;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/**
 * 解析 Accept-Language 头（形如 "zh-CN,zh;q=0.9,en;q=0.8"）：
 * 按 q 值降序取首个能匹配 SUPPORTED_LOCALES 的语言主标签；无匹配回退 fallback。
 */
export function negotiateLocale(acceptLanguage: string | undefined | null, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (!acceptLanguage) return fallback;
  const parts = acceptLanguage
    .split(",")
    .map((p) => {
      const [tag, ...params] = p.trim().split(";");
      const q = params.map((x) => x.trim()).find((x) => x.startsWith("q="));
      return { tag: (tag ?? "").trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    // P2-3 修复：q=0 语义为"不可接受"须排除；畸形 q（NaN）一并过滤
    .filter((x) => x.tag.length > 0 && Number.isFinite(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of parts) {
    const primary = tag.split("-")[0] as string;
    if (isLocale(primary)) return primary;
    if (isLocale(tag)) return tag;
  }
  return fallback;
}

/** 结构化本地化错误：handler 抛出，渲染缝隙（dispatch/web）按请求 locale 翻译为最终文案 */
export class LocalizedError extends Error {
  readonly key: string;
  readonly params: Record<string, string | number>;
  /** 映射 ResponseFrame.code；缺省 handler-error */
  readonly code: string;

  constructor(key: string, params: Record<string, string | number> = {}, code = "handler-error") {
    // message 用英文目录兜底并插值，保证日志/堆栈可读且与 locale 无关
    const base = CATALOG.en[key] ?? key;
    super(base.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)));
    this.name = "LocalizedError";
    this.key = key;
    this.params = params;
    this.code = code;
  }
}

export function isLocalizedError(err: unknown): err is LocalizedError {
  return err instanceof LocalizedError;
}
