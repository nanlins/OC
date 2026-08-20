# providers

> 用途：容器侧 Provider 实现——claude、openai（流式增量解码）、ollama、mock + 共享工具循环

## 内容清单
- `index.ts`：Provider 工厂与自注册 barrel
- `types.ts`：AgentProvider 契约（continuation 不透明、activity 活性信号）
- `registry.ts`：Provider 自注册表
- `claude.ts`：Anthropic Claude provider（messages API + tool_use/tool_result 循环）
- `openai.ts`：OpenAI 兼容 provider（chat.completions + stream:true 增量解码）
- `mock.ts`：确定性测试 provider（echo prompt + push 队列）
- `tool-loop.ts`：共享工具循环（双协议适配 + 24KB 截断 + 错误回传）

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 stream:true 流式增量解码