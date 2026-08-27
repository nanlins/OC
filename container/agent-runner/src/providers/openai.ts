/**
 * providers/openai.ts —— OpenAI 兼容 provider（DeepSeek/GLM/Qwen/Moonshot 等兼容端点）
 *
 * 职责：chat.completions 工具循环；每轮 yield activity；finish_reason=length 截断标注。
 * 关键导出：OpenAICompatProvider
 * 借鉴：nanoclaw providers 分支 openai 形态 + 知识文档 01（finish_reason 处理）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 ai-inspector 修复：system 注入+历史持久化；name 参数化（ollama 独立键）
 */
import OpenAI from "openai";
import { getContinuation, setContinuation, getHistory, setHistory, type HistoryEntry } from "../db/session-state.ts";
import { log } from "../log-lite.ts";
import { executeToolCall, MAX_TOOL_ROUNDS, toolSchemasOpenAI } from "./tool-loop.ts";
import type { AgentProvider, ProviderEvent, QueryInput } from "./types.ts";
import type { RunnerConfig } from "../config.ts";
import type { ToolContext } from "../mcp-tools/registry.ts";
import type { RoutingContext } from "../formatter.ts";

/** 阶段 12 上下文治理：工具结果入历史前的摘要长度（setHistory 还会再按 500 字符兜底截断） */
const TOOL_DIGEST_CHARS = 500;

export class OpenAICompatProvider implements AgentProvider {
  readonly name: string;
  private client: OpenAI;
  private model: string;
  private pushQueue: string[] = [];
  private ctxFactory: (routing?: RoutingContext) => ToolContext;

  constructor(config: RunnerConfig, ctxFactory: (routing?: RoutingContext) => ToolContext, client?: OpenAI, name = "openai") {
    this.name = name; // P2-12 修复：ollama 等复用实例不再共享 openai 的 continuation 键
    this.client =
      client ??
      new OpenAI({
        // 阶段 12（密钥网关简化版）：OC_LLM_PROXY_URL 指向宿主代理（密钥由主机注入，不进容器）；
        // 未配置代理时回退直连 OPENAI_BASE_URL（旧行为）
        apiKey: process.env.OPENAI_API_KEY ?? "proxy",
        baseURL: process.env.OC_LLM_PROXY_URL ?? process.env.OPENAI_BASE_URL ?? undefined,
      });
    this.model = config.model ?? "gpt-4o-mini";
    this.ctxFactory = ctxFactory;
  }

  push(text: string): void {
    this.pushQueue.push(text);
  }

  getContinuationId(): string | null {
    return getContinuation(this.name);
  }

  async *query(input: QueryInput): AsyncIterable<ProviderEvent> {
    // P1-3 修复：从 session_state 恢复历史（真实多轮上下文）
    const history = getHistory(this.name);
    const messages: Array<Record<string, unknown>> = [];
    if (input.system) messages.push({ role: "system", content: input.system });
    for (const h of history) {
      // 阶段 12：持久化的工具摘要条目（role="tool" 无 tool_call_id）转 user 文本，避免 OpenAI API 400
      if (h.role === "tool") {
        messages.push({ role: "user", content: `[此前工具执行记录] ${h.content}` });
      } else {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: "user", content: input.prompt });
    const tracked: HistoryEntry[] = [...history, { role: "user", content: input.prompt }];
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      while (this.pushQueue.length > 0) {
        const extra = this.pushQueue.shift() ?? "";
        messages.push({ role: "user", content: extra });
        tracked.push({ role: "user", content: extra });
      }
      yield { type: "activity" };
      let res;
      try {
        res = await this.client.chat.completions.create({
          model: this.model,
          messages: messages as unknown as OpenAI.ChatCompletionMessageParam[],
          tools: toolSchemasOpenAI() as unknown as OpenAI.ChatCompletionTool[],
          stream: true, // fix-plan 流式：请求流式；按响应形状自动检测（假客户端返回完整对象则走非流式）
        });
      } catch (err) {
        yield { type: "error", message: String(err) };
        return;
      }
      // fix-plan 流式：把流式/非流式响应归一为 { id, content, toolCalls, finishReason }
      type NormToolCall = { id: string; name: string; arguments: string };
      let id = "openai-session";
      let content = "";
      let finishReason: string | null = null;
      let toolCalls: NormToolCall[] = [];
      if (res != null && typeof (res as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
        // 流式：增量解码 content 并 yield progress；按 index 累积 tool_calls 增量
        const tcAcc = new Map<number, NormToolCall>();
        const stream = res as AsyncIterable<{
          id?: string;
          choices?: Array<{
            finish_reason?: string | null;
            delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
          }>;
        }>;
        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          const delta = choice?.delta;
          if (delta?.content) {
            content += delta.content;
            yield { type: "progress", message: delta.content };
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const cur = tcAcc.get(idx) ?? { id: "", name: "", arguments: "" };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name += tc.function.name;
              if (tc.function?.arguments) cur.arguments += tc.function.arguments;
              tcAcc.set(idx, cur);
            }
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk.id) id = chunk.id;
        }
        toolCalls = [...tcAcc.values()].filter((t) => t.name);
      } else {
        // 非流式（测试假客户端 / 不支持流的端点）
        const choice = (res as { choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> }).choices?.[0];
        if (!choice) {
          yield { type: "error", message: "empty choices" };
          return;
        }
        id = (res as { id?: string }).id ?? "openai-session";
        content = choice.message?.content ?? "";
        finishReason = choice.finish_reason ?? null;
        toolCalls = (choice.message?.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));
      }
      setContinuation(this.name, id);
      if (toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: content || null,
          tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })),
        });
        for (const call of toolCalls) {
          const out = await executeToolCall(call.name, call.arguments, this.ctxFactory(input.routing));
          messages.push({ role: "tool", tool_call_id: call.id, content: out });
          // 阶段 12 上下文治理：工具结果摘要入持久历史（setHistory 时按 500 字符截断）——
          // 跨请求可见，agent 下一轮知道"试过什么、结果如何"，不再重复探索（happy-dom→Browser→apt→Playwright 死循环根因）
          tracked.push({ role: "tool", content: `[tool:${call.name}] ${out.slice(0, TOOL_DIGEST_CHARS)}` });
        }
        continue;
      }
      const text = content;
      tracked.push({ role: "assistant", content: text });
      setHistory(this.name, tracked); // P1-3 修复：历史持久化（条目/字节双上限轮换）
      yield { type: "result", text: finishReason === "length" ? `${text}\n[…truncated]` : text };
      return;
    }
    log("openai provider exceeded max tool rounds", "warn");
    yield { type: "error", message: "max tool rounds exceeded" };
  }
}
