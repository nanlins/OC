/**
 * providers/tool-loop.ts —— 共享的 in-process 工具执行循环（OpenAI/Anthropic 协议适配）
 *
 * 职责：把 mcp-tools 注册表暴露为两家协议的工具定义；执行工具调用并回传结果（错误也回传）。
 * 关键导出：toolSchemasOpenAI, toolSchemasAnthropic, executeToolCall, MAX_TOOL_ROUNDS
 * 核心模式：模型只生成调用意图，真正执行在业务侧（知识文档 1.9 承重认知）。
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 ai-inspector 修复：工具结果 24KB 截断
 */
import { allTools, getTool, type ToolContext } from "../mcp-tools/registry.ts";

export function toolSchemasOpenAI(): Array<Record<string, unknown>> {
  return allTools().map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function toolSchemasAnthropic(): Array<Record<string, unknown>> {
  return allTools().map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

export async function executeToolCall(name: string, argsJson: string, ctx: ToolContext): Promise<string> {
  const tool = getTool(name);
  if (!tool) return JSON.stringify({ error: `unknown tool: ${name}` });
  try {
    const args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
    const out = await tool.handler(args, ctx);
    const serialized = JSON.stringify(out);
    if (serialized.length > TOOL_RESULT_MAX_CHARS) {
      return `${serialized.slice(0, TOOL_RESULT_MAX_CHARS)}\n[…tool result truncated at ${TOOL_RESULT_MAX_CHARS} chars]`;
    }
    return serialized;
  } catch (err) {
    // 工具错误回传给模型（附可操作提示），不抛异常中断循环
    return JSON.stringify({ error: String(err) });
  }
}

/** 预算护栏：防 Agent 无限打转（知识文档 4.2）。
 *  阶段 12 实测：10 轮对"读大文件+分析"场景过紧（分析 HTML 原型即触发熔断），放宽至 25。 */
export const MAX_TOOL_ROUNDS = 25;

/** P1-7 修复：工具结果截断上限（上下文窗口预算，知识文档 01） */
export const TOOL_RESULT_MAX_CHARS = 24_000;
