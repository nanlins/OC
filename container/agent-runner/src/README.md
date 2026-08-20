# src

> 用途：Agent Runner 源码——轮询循环、消息格式化、Provider 抽象、MCP 工具、KB 检索、技能加载、记忆

## 内容清单
- `index.ts`：容器入口（loadConfig → scaffold → tools → provider → poll loop + CLAUDE.md 注入）
- `poll-loop.ts`：主循环（清 stale ack → 轮询 → 累积门控 → 格式化 → provider.query → 流式写首条+节流 edit → markCompleted）
- `config.ts`：配置加载（/workspace/agent/container.json）
- `formatter.ts`：消息格式化（XML 分块 + 属性转义 + internal 剥离 + 路由提取）
- `destinations.ts`：出站目的地附录
- `claude-md.ts`：群组 CLAUDE.md 加载与系统提示注入
- `log-lite.ts` / `timezone-lite.ts`：容器内轻量工具
- `cli/`：容器内 ncl（DB 传输，非 socket）
- `db/`：会话 DB 访问层
- `providers/`：Provider 实现
- `mcp-tools/`：MCP 工具集
- `memory/`：记忆脚手架
- `skills/`：技能加载器
- `scheduling/`：任务前置门控

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 claude-md.ts + kb-search.ts + 流式增量投递