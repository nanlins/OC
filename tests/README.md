# tests

> 用途：测试体系——单元/集成/eval/夹具，CI 全 Mock 不真调 LLM/Docker/网络

## 内容清单
- `unit/`：单元测试（快速、无 IO、纯函数）
- `integration/`：集成测试（真实 SQLite + temp dir + 真实 socket 回环）
- `eval/`：评估测试（RAG 评估集 21+3 用例）
- `e2e/`：端到端测试（可选，Docker 环境）
- `fixtures/`：测试夹具（MockProvider/MockAdapter/内存 DB 帮助函数）

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 trace-safety/rag-vector/i18n-eval 测试