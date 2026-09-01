/**
 * providers/ollama.ts —— Ollama provider（OpenAI 兼容薄包装）
 *
 * 职责：复用 OpenAICompatProvider，仅把 baseURL 指向 Ollama（/v1），独立 continuation 键。
 *       阶段 12 重写：原粗糙流式实现不符合 AgentProvider 契约（yield 了非法事件类型），
 *       改为复用 OpenAICompatProvider 以同时获得工具循环/历史治理/类型安全。
 * 关键导出：OllamaProvider
 * 借鉴：nanoclaw providers 分支 openai 形态；主机侧 providers/ollama.ts 同语义。
 *
 * 修改记录：
 *   2026-08-24 创建（阶段 10 补齐）
 *   2026-08-27 阶段 12 重写为 OpenAICompatProvider 薄包装（修复 TS2322 事件类型错误）
 */
import OpenAI from "openai";
import type { RunnerConfig } from "../config.ts";
import type { ToolContext } from "../mcp-tools/registry.ts";
import type { RoutingContext } from "../formatter.ts";
import { OpenAICompatProvider } from "./openai.ts";

export class OllamaProvider extends OpenAICompatProvider {
  constructor(config: RunnerConfig, ctxFactory: (routing?: RoutingContext) => ToolContext) {
    const base =
      process.env.OLLAMA_HOST ?? process.env.OPENAI_BASE_URL ?? "http://host.docker.internal:11434/v1";
    const client = new OpenAI({ apiKey: "ollama", baseURL: base });
    super(config, ctxFactory, client, "ollama");
  }
}
