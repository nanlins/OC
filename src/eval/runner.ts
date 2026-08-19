/**
 * eval/runner.ts —— RAG 评估 runner（检索 + 判分 + 拒答 + 报告落盘）
 *
 * 职责：runRagEval({search, judge, cases}) → EvalReport；writeReport 落 data/eval/report-<ts>.json。
 * 关键导出：runRagEval, writeReport
 * 借鉴：知识文档 03 §3.9 评估流程（测试集→基线→自动评估→失败归类→回归）
 *
 * 修改记录：2026-08-13 创建（阶段 12）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.js";
import { computeRetrievalMetrics, type RetrievalResult } from "./retrieval-metrics.js";
import type { Judge } from "./judge.js";
import type { EvalCase, EvalReport } from "./types.js";

export interface SearchFn {
  (question: string, k: number): Array<{ title: string; content: string }>;
}

export interface AnswerFn {
  (question: string, context: Array<{ title: string; content: string }>): string;
}

export async function runRagEval(opts: {
  cases: EvalCase[];
  search: SearchFn;
  answer: AnswerFn;
  judge: Judge;
  k?: number;
}): Promise<EvalReport> {
  const k = opts.k ?? 3;
  const retrievalResults: RetrievalResult[] = [];
  const failures: EvalReport["failures"] = [];
  const judgeScores: number[] = [];
  let refusalCorrect = 0;
  let refusalTotal = 0;

  for (const c of opts.cases) {
    const hits = opts.search(c.question, k);
    retrievalResults.push({ caseId: c.id, hits: hits.map((h) => h.title) });
    if (c.outOfDomain) {
      refusalTotal += 1;
      const answer = opts.answer(c.question, hits);
      const jr = await opts.judge.judge(c, answer);
      judgeScores.push(jr.score);
      if (jr.passed) refusalCorrect += 1;
      else failures.push({ caseId: c.id, question: c.question, reason: jr.reason });
      continue;
    }
    const answer = opts.answer(c.question, hits);
    const jr = await opts.judge.judge(c, answer);
    judgeScores.push(jr.score);
    if (!jr.passed) failures.push({ caseId: c.id, question: c.question, reason: jr.reason });
  }

  const retrieval = computeRetrievalMetrics(opts.cases, retrievalResults, k);
  const avg = judgeScores.length ? judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length : 0;
  return {
    generatedAt: new Date().toISOString(),
    corpusSize: opts.cases.length,
    retrieval,
    judge: {
      avgScore: avg,
      passRate: judgeScores.length ? judgeScores.filter((s) => s >= 0.5).length / judgeScores.length : 0,
    },
    refusal: { correct: refusalCorrect, total: refusalTotal },
    failures,
  };
}

export function writeReport(report: EvalReport): string {
  const dir = join(DATA_DIR, "eval");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `report-${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}
