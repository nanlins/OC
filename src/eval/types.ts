/**
 * eval/types.ts —— 评估体系类型
 *
 * 关键导出：EvalCase, JudgeResult, EvalReport, TraceEvent
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 12）
 *   2026-09-16 EvalCase 新增 expectedDocs（多相关文档标注），使 recallAtK 可与 hitRate 区分
 */
export interface EvalCase {
  id: string;
  domain: string;
  question: string;
  /** 期望命中的文档标题（检索评估，单相关文档标注） */
  expectedDoc?: string;
  /**
   * 期望命中的文档标题集合（检索评估，多相关文档标注）。提供时优先于 expectedDoc。
   * 只有多相关文档标注才能让 recallAtK 与 hitRate 区分：单文档时 recall = 命中数/1，
   * 恒等于 hitRate 的 0|1 判定（数学退化，见 retrieval-metrics.ts 头注释）。
   */
  expectedDocs?: string[];
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
