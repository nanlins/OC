/**
 * mcp-tools/registry.ts —— 工具注册表（MCP server 与 in-process provider 共用）
 *
 * 职责：registerTools/allTools/getTool；重名跳过并告警。
 * 关键导出：McpToolDefinition, registerTools, allTools, getTool, ToolContext
 * 核心模式：新增工具=建文件+registerTools+追加 import，无中心清单。
 * 借鉴：nanoclaw container/agent-runner/src/mcp-tools
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import { log } from "../log-lite.ts";
import type { RoutingContext } from "../formatter.ts";

export interface ToolContext {
  routing: RoutingContext;
  assistantName: string | null;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  /** JSON Schema（参数） */
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const toolMap = new Map<string, McpToolDefinition>();

export function registerTools(tools: McpToolDefinition[]): void {
  for (const t of tools) {
    if (toolMap.has(t.name)) {
      log(`mcp tool duplicate skipped: ${t.name}`, "warn");
      continue;
    }
    toolMap.set(t.name, t);
  }
}

export function allTools(): McpToolDefinition[] {
  return [...toolMap.values()];
}

export function getTool(name: string): McpToolDefinition | undefined {
  return toolMap.get(name);
}

/** 仅供测试 */
export function clearToolsForTest(): void {
  toolMap.clear();
}
