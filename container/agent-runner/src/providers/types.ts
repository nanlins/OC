/**
 * providers/types.ts —— AgentProvider 契约
 *
 * 职责：continuation 对 poll-loop 不透明、由 provider 自行解释；activity 事件是强制活性信号。
 * 关键导出：AgentProvider, ProviderEvent, QueryInput
 * 借鉴：nanoclaw container/agent-runner/src/providers/types.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import type { RoutingContext } from "../formatter.ts";

export type ProviderEvent =
  | { type: "activity" }
  | { type: "init"; sessionId: string }
  | { type: "result"; text: string; isError?: boolean }
  | { type: "error"; message: string }
  | { type: "progress"; message: string };

export interface QueryInput {
  prompt: string;
  routing: RoutingContext;
  /** 系统提示（目的地附录 + 记忆恒载），P1-1 修复 */
  system?: string;
}

export interface AgentProvider {
  readonly name: string;
  /** 流式查询：yield activity（活性）/ init（会话 id）/ result（最终文本）/ error */
  query(input: QueryInput): AsyncIterable<ProviderEvent>;
  /** 查询进行中追加新消息（热路径） */
  push(text: string): void;
  /** continuation（SDK session id / thread id），null = 全新会话 */
  getContinuationId(): string | null;
}
