/**
 * eval/retrieval-metrics.ts —— 检索指标（知识文档 03 §3.9）
 *
 * 职责：hitRate / recallAtK / MRR 纯函数计算。
 * 关键导出：computeRetrievalMetrics
 *
 * 修改记录：2026-08-13 创建（阶段 12）
 */
import type { EvalCase } from "./types.js";

export interface RetrievalResult {
  caseId: string;
  /** 按排名返回的命中文档标题列表 */
  hits: string[];
}

export function computeRetrievalMetrics(
  cases: EvalCase[],
  results: RetrievalResult[],
  k = 3,
): {
  hitRate: number;
  recallAtK: number;
  mrr: number;
} {
  const judged = cases.filter((c) => c.expectedDoc && !c.outOfDomain);
  if (judged.length === 0) return { hitRate: 0, recallAtK: 0, mrr: 0 };
  let hit = 0;
  let rrSum = 0;
  for (const c of judged) {
    const expected = c.expectedDoc as string;
    const r = results.find((x) => x.caseId === c.id);
    const top = (r?.hits ?? []).slice(0, k);
    const idx = top.findIndex((t) => t === expected);
    if (top.includes(expected)) hit += 1;
    if (idx >= 0) rrSum += 1 / (idx + 1);
  }
  return {
    hitRate: hit / judged.length,
    recallAtK: hit / judged.length,
    mrr: rrSum / judged.length,
  };
}
