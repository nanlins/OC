/**
 * mcp-tools/index.ts —— 工具 barrel + MCP stdio server
 *
 * 职责：bootstrapTools 注册全部工具；startMcpServer 以 @modelcontextprotocol/sdk 暴露 ListTools/CallTool。
 * 关键导出：startMcpServer, bootstrapTools
 * 借鉴：nanoclaw container/agent-runner/src/mcp-tools/{index,server}.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerCoreTools } from "./core.ts";
import { registerFilesBashTools } from "./files-bash.ts";
import { registerInteractiveSchedulingWebTools } from "./interactive-scheduling-web.ts";
import { registerKbSearchTool } from "./kb-search.ts";
import { allTools, getTool, type ToolContext } from "./registry.ts";

export function bootstrapTools(): void {
  registerCoreTools();
  registerFilesBashTools();
  registerInteractiveSchedulingWebTools();
  registerKbSearchTool();
}

export async function startMcpServer(ctx: ToolContext): Promise<void> {
  bootstrapTools();
  const server = new Server({ name: "oc", version: "0.0.1" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = getTool(req.params.name);
    if (!tool) {
      return { content: [{ type: "text", text: `unknown tool: ${req.params.name}` }], isError: true };
    }
    try {
      const result = await tool.handler((req.params.arguments ?? {}) as Record<string, unknown>, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      // 工具错误作为 tool result 回传（让模型自修复），不抛异常中断
      return { content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
}
