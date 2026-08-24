/**
 * tests/fixtures/mock-provider.ts —— Mock LLM Provider
 *
 * 职责：确定性输出 Provider，用于测试。不调用真实 API，返回预定义响应。
 * 关键导出：createMockProvider, MockProviderConfig
 * 借鉴：测试策略文档第十二章
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */

import { randomUUID } from "node:crypto";

export interface MockProviderConfig {
  /** 按消息索引映射的响应文本 */
  responses?: string[];
  /** 默认响应（当索引超出 responses 时） */
  defaultResponse?: string;
  /** 模拟延迟（毫秒） */
  delayMs?: number;
  /** 是否模拟工具调用 */
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
}

export interface MockProviderInstance {
  name: string;
  model: string;
  query: (q: { messages: Array<{ role: string; content: string }>; signal?: AbortSignal }) => AsyncIterable<{
    type: string;
    text?: string;
    toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    reason?: string;
  }>;
}

export function createMockProvider(config: MockProviderConfig = {}): MockProviderInstance {
  const responses = config.responses ?? ["Mock response"];
  const defaultResponse = config.defaultResponse ?? "Mock default response";
  const delayMs = config.delayMs ?? 0;
  const toolCalls = config.toolCalls;
  let callCount = 0;

  return {
    name: "mock",
    model: "mock",
    async *query(q: { messages: Array<{ role: string; content: string }>; signal?: AbortSignal }) {
      callCount++;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const text = (responses[callCount - 1] ?? defaultResponse) + ` [call=${callCount}, msgs=${q.messages.length}]`;
      yield { type: "text", text };

      if (toolCalls) {
        yield {
          type: "tool_calls",
          toolCalls: toolCalls.map((tc) => ({
            id: randomUUID(),
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
      }
      yield { type: "finish", reason: "stop" };
    },
  };
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

