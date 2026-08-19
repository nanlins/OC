/**
 * providers/mock.ts —— 确定性测试 provider
 *
 * 职责：echo prompt + push 产生额外 result；CI 全 Mock 不真调 LLM。
 * 关键导出：MockProvider
 * 借鉴：nanoclaw container/agent-runner/src/providers/mock.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import type { AgentProvider, ProviderEvent, QueryInput } from "./types.ts";

export class MockProvider implements AgentProvider {
  readonly name = "mock";
  private pushQueue: string[] = [];
  /** 测试钩子：自定义应答函数 */
  responder: (prompt: string) => string = (p) => `echo: ${p}`;

  push(text: string): void {
    this.pushQueue.push(text);
  }

  getContinuationId(): string | null {
    return "mock-session";
  }

  async *query(input: QueryInput): AsyncIterable<ProviderEvent> {
    yield { type: "activity" };
    yield { type: "init", sessionId: "mock-session" };
    yield { type: "result", text: this.responder(input.prompt) };
    while (this.pushQueue.length > 0) {
      const extra = this.pushQueue.shift() ?? "";
      yield { type: "result", text: `echo: ${extra}` };
    }
  }
}
