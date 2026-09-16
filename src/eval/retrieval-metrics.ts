/**
 * eval/retrieval-metrics.ts —— 检索指标（知识文档 03 §3.9）
 *
 * 职责：hitRate / recallAtK / MRR 纯函数计算。
 * 关键导出：computeRetrievalMetrics, relevantDocsOf
 * 承重不变量：三个指标的分母不同，不可互相替代——
 *   hitRate   分母是「查询数」，乐观口径：top-k 至少命中一个相关文档就记 1；
 *   recallAtK 分母是「相关文档数」，严格口径：捞回了该捞的多少比例；
 *   mrr       只看第一个命中的排名位置。
 *   当每个查询只标注一个相关文档时 recallAtK 在数学上退化为 hitRate（命中数/1 == 0|1 判定），
 *   这是标注模型的性质而非实现缺陷；要让两者真正区分，语料必须提供多相关文档标注
 *   （EvalCase.expectedDocs）。tests/integration/eval.test.ts 对两种情形各有断言锁定。
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 12）
 *   2026-09-16 修复 recallAtK 与 hitRate 返回同一表达式：改为 |top-k ∩ relevant| / |relevant|；
 *              新增 relevantDocsOf 作为标注归一化唯一入口（expectedDocs 优先，回落 expectedDoc）；
 *              交集前对 hits 去重，防检索器重复返回同一文档虚增召回
 */
import type { EvalCase } from "./types.js";

export interface RetrievalResult {
  caseId: string;
  /** 按排名返回的命中文档标题列表 */
  hits: string[];
}

/**
 * 用例的相关文档集合（标注归一化唯一入口）。
 * expectedDocs 优先 → 回落单个 expectedDoc → 都没有则空集（该用例不参与检索指标）。
 * 域外用例恒为空集：它考核的是拒答而不是召回。
 */
export function relevantDocsOf(c: EvalCase): string[] {
  if (c.outOfDomain) return [];
  if (c.expectedDocs && c.expectedDocs.length > 0) return c.expectedDocs;
  return c.expectedDoc ? [c.expectedDoc] : [];
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
  const judged = cases.filter((c) => relevantDocsOf(c).length > 0);
  if (judged.length === 0) return { hitRate: 0, recallAtK: 0, mrr: 0 };
  let hit = 0;
  let recallSum = 0;
  let rrSum = 0;
  for (const c of judged) {
    const relevant = new Set(relevantDocsOf(c));
    const r = results.find((x) => x.caseId === c.id);
    const top = (r?.hits ?? []).slice(0, k);
    const found = new Set(top.filter((t) => relevant.has(t)));
    if (found.size > 0) hit += 1;
    recallSum += found.size / relevant.size;
    const idx = top.findIndex((t) => relevant.has(t));
    if (idx >= 0) rrSum += 1 / (idx + 1);
  }
  return {
    hitRate: hit / judged.length,
    recallAtK: recallSum / judged.length,
    mrr: rrSum / judged.length,
  };
}
