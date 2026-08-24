/**
 * providers/ollama.ts —— Ollama provider（容器侧）
 *
 * 职责：通过 OpenAI 兼容 API 调用本地 Ollama 模型。通过 OPENAI_BASE_URL 环境变量
 *       指向 Ollama 端点（如 http://localhost:11434/v1），模型名按 Ollama 格式。
 * 关键导出：OllamaProvider, createOllamaProvider
 * 借鉴：容器侧 provider 标准接口
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import type { AgentProvider, AgentQuery, ProviderEvent } from "./types.js";

export interface OllamaProviderOptions {
  model?: string;
  baseUrl?: string;
}

export function createOllamaProvider(opts: OllamaProviderOptions = {}): AgentProvider {
  const baseUrl = opts.baseUrl || process.env.OPENAI_BASE_URL || "http://localhost:11434/v1";
  const model = opts.model || process.env.OLLAMA_MODEL || "llama3.1";

  return {
    name: "ollama",
    model,
    async *query(q: AgentQuery): AsyncIterable<ProviderEvent> {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: q.messages,
          stream: true,
          tools: q.tools,
        }),
        signal: q.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Ollama: no response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string; tool_calls?: unknown[] }; finish_reason?: string }>;
            };
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            if (choice.delta?.content) {
              yield { type: "text", text: choice.delta.content };
            }
            if (choice.delta?.tool_calls) {
              yield {
                type: "tool_calls",
                toolCalls: choice.delta.tool_calls as Array<{
                  id: string;
                  function: { name: string; arguments: string };
                }>,
              };
            }
            if (choice.finish_reason) {
              yield { type: "finish", reason: choice.finish_reason };
            }
          } catch {
            // 忽略解析失败的行
          }
        }
      }
    },
    push(_messages) {
      // Ollama 不支持查询中追加消息
    },
    registerMemorySessionHook(_hook) {
      // Ollama 无 SDK 会话钩子
    },
  };
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

