/**
 * mcp-tools/subagent.ts —— task 子agent 工具（阶段 12 路径 B）
 *
 * 职责：让主 LLM 把一个子任务委派给一个受限的"子agent"（独立、有界工具循环），
 *       返回子agent 的最终文本。等价于 nanoclaw 经 Claude SDK 获得的 Task 工具的轻量自建版，
 *       运行在现有 OpenAI 兼容循环上（不换 key）。
 * 关键导出：registerSubagentTool
 * 承重不变量：子agent 工具集受限（只读+受限 bash）+ 轮次有界（SUBAGENT_ROUNDS），不递归 spawn。
 * 借鉴：nanoclaw TOOL_ALLOWLIST 的 Task/TaskOutput（SDK 内置），此处为 DeepSeek 轻量自建版。
 *
 * 修改记录：2026-08-27 创建（阶段 12 路径 B：轻量子任务能力）
 */
import OpenAI from "openai";
import { executeToolCall } from "../providers/tool-loop.ts";
import type { ToolContext } from "./registry.ts";
import { registerTools } from "./registry.ts";

/** 子agent 轮次上限（有界，防打转） */
const SUBAGENT_ROUNDS = 8;
/** 子agent 可用工具（只读 + 受限 bash，不给 send_message 等对外工具） */
const SUBAGENT_TOOLS = ["read_file", "list_files", "bash"];

function buildClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? "proxy",
    baseURL: process.env.OC_LLM_PROXY_URL ?? process.env.OPENAI_BASE_URL ?? undefined,
  });
}

async function runSubagent(prompt: string, model: string, ctx: ToolContext): Promise<string> {
  const client = buildClient();
  const { allTools } = await import("./registry.ts");
  const toolDefs = allTools()
    .filter((t) => SUBAGENT_TOOLS.includes(t.name))
    .map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));

  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content:
        "You are a focused subagent. Complete ONLY the given sub-task using the provided tools. " +
        "Be concise; return the outcome, not a transcript. Do not message the user directly.",
    },
    { role: "user", content: prompt },
  ];

  for (let round = 0; round < SUBAGENT_ROUNDS; round++) {
    const res = await client.chat.completions.create({ model, messages: messages as never[], tools: toolDefs as never[] });
    const choice = res.choices?.[0];
    const msg = choice?.message;
    const toolCalls = (msg?.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));
    if (toolCalls.length > 0) {
      messages.push({ role: "assistant", content: msg?.content ?? null, tool_calls: msg?.tool_calls });
      for (const call of toolCalls) {
        const out = await executeToolCall(call.name, call.arguments, ctx);
        messages.push({ role: "tool", tool_call_id: call.id, content: out });
      }
      continue;
    }
    return msg?.content ?? "(subagent returned empty)";
  }
  return "(subagent exceeded round limit)";
}

export function registerSubagentTool(): void {
  registerTools([
    {
      name: "task",
      description:
        "Delegate a self-contained sub-task to a bounded subagent (read-only tools + limited bash). " +
        "Use to isolate an exploratory sub-task so its tool noise does not pollute your main loop. Returns the subagent's final text.",
      parameters: {
        type: "object",
        properties: { description: { type: "string" }, prompt: { type: "string" }, model: { type: "string" } },
        required: ["prompt"],
      },
      handler: async (args, ctx) => {
        const prompt = String(args.prompt ?? "");
        if (!prompt.trim()) return JSON.stringify({ error: "task requires prompt" });
        const model = String(args.model ?? process.env.OPENAI_MODEL ?? "deepseek-chat");
        try {
          const text = await runSubagent(prompt, model, ctx);
          return { result: text };
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      },
    },
  ]);
}
