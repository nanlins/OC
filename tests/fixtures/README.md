# fixtures

> 用途：测试夹具——MockProvider、MockAdapter、内存 DB 帮助函数

## 内容清单
- `mock-provider.ts`：Mock LLM Provider（确定性输出，可配置延迟/工具调用）
- `mock-adapter.ts`：Mock 通道适配器（内存收发，无网络调用）
- `memory-db.ts`：测试 DB 初始化（setupTestDb 封装 initTestDb + runMigrations）

## 修改记录
- 2026-08-12 创建
- 2026-08-24 补齐未完成清单：mock-provider + mock-adapter + memory-db