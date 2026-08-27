/**
 * providers/claude.ts —— Anthropic Claude provider（messages API + 工具循环）
 *
 * 职责：与 openai.ts 同构的 Anthropic 协议实现；tool_use/tool_result content blocks。
 * 关键导出：ClaudeProvider
 * 借鉴：nanoclaw container/agent-runner/src/providers/claude.ts（简化为 messages API 形态）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 ai-inspector 修复：system 注入+历史持久化；max_tokens 截断标注；空文本兜底
 */
import Anthropic from "@anthropic-ai/sdk";
import { getContinuation, setContinuation, getHistory, setHistory, type HistoryEntry } from "../db/session-state.ts";
import { log } from "../log-lite.ts";
import { executeToolCall, MAX_TOOL_ROUNDS, toolSchemasAnthropic } from "./tool-loop.ts";
import type { AgentProvider, ProviderEvent, QueryInput } from "./types.ts";
import type { RunnerConfig } from "../config.ts";
import type { ToolContext } from "../mcp-tools/registry.ts";
import type { RoutingContext } from "../formatter.ts";

/** 阶段 12 上下文治理：工具结果入历史前的摘要长度（setHistory 还会再按 500 字符兜底截断） */
const TOOL_DIGEST_CHARS = 500;

export class ClaudeProvider implements AgentProvider {
  readonly name = "claude";
  private client: Anthropic;
  private model: string;
  private pushQueue: string[] = [];
  private ctxFactory: (routing?: RoutingContext) => ToolContext;

  constructor(config: RunnerConfig, ctxFactory: (routing?: RoutingContext) => ToolContext, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "missing" });
    this.model = config.model ?? "claude-sonnet-4-5";
    this.ctxFactory = ctxFactory;
  }

  push(text: string): void {
    this.pushQueue.push(text);
  }

  getContinuationId(): string | null {
    return getContinuation(this.name);
  }

  async *query(input: QueryInput): AsyncIterable<ProviderEvent> {
    // P1-3 修复：从 session_state 恢复历史
    const history = getHistory(this.name);
    const system = input.system;
    const tracked: HistoryEntry[] = [...history, { role: "user", content: input.prompt }];
    const historyMsgs: Anthropic.MessageParam[] = history.map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    }));
    const historyTail: Anthropic.MessageParam[] = [{ role: "user", content: input.prompt }];
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      while (this.pushQueue.length > 0) {
        const extra = this.pushQueue.shift() ?? "";
        historyTail.push({ role: "user", content: extra });
        tracked.push({ role: "user", content: extra });
      }
      yield { type: "activity" };
      let res: Anthropic.Message;
      try {
        res = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          ...(system ? { system } : {}),
          messages: [...historyMsgs, ...historyTail],
          tools: toolSchemasAnthropic() as unknown as Anthropic.Tool[],
        });
      } catch (err) {
        yield { type: "error", message: String(err) };
        return;
      }
      setContinuation(this.name, res.id);
      yield { type: "init", sessionId: res.id };
      const toolUses = res.content.filter((b) => b.type === "tool_use");
      const textBlocks = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
      if (res.stop_reason === "tool_use" && toolUses.length > 0) {
        historyTail.push({ role: "assistant", content: res.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of toolUses) {
          // fix-plan P0：把本批次真实 routing 注入工具上下文（send_message 等据此路由）
          const out = await executeToolCall(use.name, JSON.stringify(use.input), this.ctxFactory(input.routing));
          results.push({ type: "tool_result", tool_use_id: use.id, content: out });
          // 阶段 12 上下文治理：工具结果摘要入持久历史（跨请求防重复探索，setHistory 兜底截断）
          tracked.push({ role: "tool", content: `[tool:${use.name}] ${out.slice(0, TOOL_DIGEST_CHARS)}` });
        }
        historyTail.push({ role: "user", content: results });
        continue;
      }
      const text = textBlocks.join("\n");
      tracked.push({ role: "assistant", content: text });
      setHistory(this.name, tracked);
      // P2-8 修复：max_tokens 截断标注；空文本不写空消息
      const finalText = res.stop_reason === "max_tokens" ? `${text}\n[…truncated]` : text;
      yield { type: "result", text: finalText || "(empty response)" };
      return;
    }
    log("claude provider exceeded max tool rounds", "warn");
    yield { type: "error", message: "max tool rounds exceeded" };
  }
}
