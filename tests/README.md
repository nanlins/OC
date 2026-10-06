# tests

> 用途：测试体系——单元/集成/eval/夹具，CI 全 Mock 不真调 LLM/Docker/网络

## 内容清单
- `unit/`：单元测试（快速、无 IO、纯函数）
- `integration/`：集成测试（真实 SQLite + temp dir + 真实 socket 回环）
- `eval/`：评估测试（RAG 评估集）
- `e2e/`：端到端测试（可选，需 OC_E2E=1 + 真实凭据 + Docker）
- `fixtures/`：测试夹具（MockProvider/MockAdapter/内存 DB 帮助函数）

## 测试计数与 skip 口径（R-1，可复现）

`pnpm test`（无 OC_E2E、无 Docker）的预期输出是：

```
Test Files  56 passed (56)
Tests       523 passed | 6 skipped (529)
```

**6 个 skip 全部来自 e2e 的显式前置条件跳过，共两组、每组 3 个**，没有其它隐藏跳过：

| # | 测试 | 跳过条件 |
|---|---|---|
| 1 | `tests/e2e/deepseek-live.test.ts` > T1-2 live DeepSeek end-to-end > a real Chinese message… | `describe.skipIf`：未设 `OC_E2E=1`，或环境无 `OPENAI_API_KEY`，或 `docker info`（8s 超时）不可达 |
| 2 | 同上 > the container really ran… | 同上 |
| 3 | 同上 > both upstream profiles return real text… | 同上 |
| 4 | `tests/e2e/container-e2e.test.ts` > container-e2e > the container runtime answers a version probe | `describe.skipIf`：未设 `OC_E2E=1` 或 `docker info` 不可达 |
| 5 | 同上 > the runtime can list running containers… | 同上 |
| 6 | 同上 > the OC agent image is present… | 同上 |

两组各自还有一个"preconditions"测试**通过**（不是 skip）：它断言跳过原因非空，
把"为什么跳过"打印进测试输出——跳过是显式声明，不是空过。

**计数规则**：
- 报告中引用的 skip 数 = 上面 6 个，且必须逐项列名（本表即清单）；
- 带 `OC_E2E=1` + 真实凭据 + Docker 时：6 个 skip 变为 6 个执行（deepseek-live 3 个
  真实跑 DeepSeek，container-e2e 3 个真实跑 Docker 探测），预期变为 `529 passed | 0 skipped`；
- 名称里含 "skip" 字样的**通过**测试（如 "second run skips"、"script-skip:error"）不是
  skip，不得计入。

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 trace-safety/rag-vector/i18n-eval 测试
- 2026-10-06 R-1：补充 skip 清单与可复现口径（6 skipped = deepseek-live 3 + container-e2e 3）
