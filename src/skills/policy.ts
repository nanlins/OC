/**
 * skills/policy.ts —— 无 UI 驱动策略（展示策略从文档结构推导）
 *
 * 职责：gatePolicy：operator 后下一兼容指令为副作用类（run/copy/dep/json-merge/env-set）→ 需确认；
 *       extractOfferUrl：提取首个可打开 URL（剥尾部标点、排除占位符）。
 * 关键导出：gatePolicy, extractOfferUrl
 * 核心模式：引擎只 DECLARE/EMIT，绝不 ACQUIRE/PRESENT（nanoclaw skill-policy.ts 同语义）。
 * 借鉴：nanoclaw scripts/skill-policy.ts
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 8）
 */
import { parseDirectives, type Directive } from "./directives.js";

const SIDE_EFFECT = new Set(["run", "copy", "dep", "json-merge", "env-set"]);

export interface GatePolicyResult {
  /** operator 后紧跟副作用指令 → 需要人工确认屏障 */
  needsConfirm: boolean;
  confirmAfterLine: number | null;
}

export function gatePolicy(md: string): GatePolicyResult {
  const dirs = parseDirectives(md).filter((d) => d.attrs.__unknown === undefined);
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i] as Directive;
    if (d.kind !== "operator") continue;
    const next = dirs[i + 1];
    if (next && SIDE_EFFECT.has(next.kind)) {
      // when 守卫不兼容分支被跳过语义：next 带 when 且与 operator 无关仍视为屏障（保守）
      return { needsConfirm: true, confirmAfterLine: d.lineNo };
    }
  }
  return { needsConfirm: false, confirmAfterLine: null };
}

export function extractOfferUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>")]+/);
  if (!m) return null;
  let url = m[0];
  // 剥尾部标点
  url = url.replace(/[.,;:!?)\]]+$/, "");
  if (url.includes("{{")) return null; // 未替换占位符
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}
