/**
 * mcp-tools/index.ts —— 工具 barrel + MCP stdio server
 *
 * ??：bootstrapTools 注?全部工具；startMcpServer 以 @modelcontextprotocol/sdk 暴露 ListTools/CallTool。
 * ???出：startMcpServer, bootstrapTools
 * 借?：nanoclaw container/agent-runner/src/mcp-tools/{index,server}.ts
 *
 * 修改??：
 *   2026-08-12 ?建（?段 4）；重?修复???坏
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
  const server = new Server({ name: "OC", version: "0.0.1" }, { capabilities: { tools: {} } });

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
      // 工具??作? tool result 回?（?模型自修复），不?异常中?
      return { content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
}
