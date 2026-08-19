/**
 * eval/types.ts —— 评估体系类型
 *
 * 关键导出：EvalCase, JudgeResult, EvalReport, TraceEvent
 *
 * 修改记录：2026-08-13 创建（阶段 12）
 */
export interface EvalCase {
  id: string;
  domain: string;
  question: string;
  /** 期望命中的文档标题（检索评估） */
  expectedDoc?: string;
  /** 期望答案要点（判分参考） */
  expectedAnswer?: string;
  /** 域外拒答用例标记 */
  outOfDomain?: boolean;
}

export interface JudgeResult {
  caseId: string;
  /** 0..1 忠实度/切题度 */
  score: number;
  passed: boolean;
  reason: string;
}

// 注：Judge 接口定义于 judge.ts（阶段 12 去重）

export interface RetrievalMetrics {
  hitRate: number;
  recallAtK: number;
  mrr: number;
}

export interface EvalReport {
  generatedAt: string;
  corpusSize: number;
  retrieval: RetrievalMetrics;
  judge: { avgScore: number; passRate: number };
  refusal: { correct: number; total: number };
  failures: Array<{ caseId: string; question: string; reason: string }>;
}

export interface TraceEvent {
  ts: string;
  sessionId: string;
  kind: "inbound" | "llm" | "tool" | "delivery" | "guard";
  detail: Record<string, unknown>;
}
