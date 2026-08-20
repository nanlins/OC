# mcp-tools

> 用途：MCP 工具集——send_message、send_file、bash、read_file、ask_user、schedule、web_fetch、kb_search 等

## 内容清单
- `index.ts`：MCP 工具 Barrel + stdio server（@modelcontextprotocol/sdk）
- `registry.ts`：工具注册表（registerTools/allTools/getTool + ToolContext）
- `core.ts`：出站四件套（send_message/send_file/edit_message/add_reaction）
- `files-bash.ts`：文件与 Bash 工具（read/write/list + bash 执行，超时 clamp 10min）
- `interactive-scheduling-web.ts`：交互/调度/Web 工具（ask_user 300s 超时 + schedule/list/cancel + web_fetch/web_search）
- `kb-search.ts`：容器内 KB 检索工具（分块 + CJK bigram 分词 + 覆盖率打分 + 引用溯源）

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 kb-search.ts