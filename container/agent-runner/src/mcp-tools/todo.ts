/**
 * mcp-tools/todo.ts —— todo_write 子任务清单工具（阶段 12 路径 B）
 *
 * 职责：让 LLM 记录/更新自己的子任务清单（类 Claude TodoWrite）。清单持久化到
 *       session_state（跨消息可见），使 LLM 在下一条消息知道"做到哪"。
 * 关键导出：registerTodoTool, renderTodosSection
 * 借鉴：nanoclaw TOOL_ALLOWLIST 的 TodoWrite（SDK 内置），此处为 DeepSeek 轻量自建版。
 *
 * 修改记录：
 *   2026-08-27 创建（阶段 12 路径 B：轻量子任务能力）
 *   2026-08-28 新增 renderTodosSection（系统提示跨消息注入当前清单）
 */
import { getTodos, setTodos, type TodoItem } from "../db/session-state.ts";
import { registerTools } from "./registry.ts";

const VALID_STATUS = new Set(["pending", "in_progress", "completed"]);

const STATUS_ICON: Record<TodoItem["status"], string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
};

/**
 * 渲染当前子任务清单为系统提示片段（跨消息可见）。
 * 每轮查询前由 index.ts 的系统提示工厂调用，使 LLM 知道"做到哪"。
 * 无清单时返回空串（不注入噪音）。
 */
export function renderTodosSection(): string {
  const todos = getTodos();
  if (todos.length === 0) return "";
  const lines = todos.map((t) => `${STATUS_ICON[t.status] ?? "[ ]"} ${t.content}`).join("\n");
  return (
    "## Current sub-task list (maintained via todo_write)\n" +
    "Update it with todo_write as you progress; exactly one item should be in_progress at a time.\n" +
    lines
  );
}

export function registerTodoTool(): void {
  registerTools([
    {
      name: "todo_write",
      description:
        "Replace your sub-task list to plan/track a large task. Each item: {content, status: pending|in_progress|completed}. " +
        "Call it as you make progress so future turns know what is done. Returns the current list.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: { content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } },
              required: ["content", "status"],
            },
          },
        },
        required: ["todos"],
      },
      handler: async (args) => {
        const raw = Array.isArray(args.todos) ? (args.todos as Array<Record<string, unknown>>) : [];
        const todos: TodoItem[] = raw
          .filter((t) => typeof t.content === "string" && t.content.trim())
          .map((t) => ({
            content: String(t.content).slice(0, 300),
            status: VALID_STATUS.has(String(t.status)) ? (String(t.status) as TodoItem["status"]) : "pending",
          }))
          .slice(0, 50);
        setTodos(todos);
        return { ok: true, todos };
      },
    },
  ]);
}
/*
 * 修改记录：
 *   2026-08-27 创建（阶段 12 路径 B：轻量子任务能力）
 *   2026-08-28 新增 renderTodosSection（系统提示跨消息注入当前清单）
 */
