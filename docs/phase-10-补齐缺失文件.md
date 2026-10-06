# phase-10-补齐缺失文件

> 阶段：补齐设计文档要求的所有缺失文件（30 项），同时修复因 OC 替换导致的乱码问题。

> **⚠ 后续变更（2026-10-06，P2-1 死代码清理）**：本阶段补齐的 `src/providers/factory.ts`
> 与 `src/providers/types.ts` 已删除——两者全仓零 import（`types.ts` 仅被同为死代码的
> `factory.ts` 引用）。实际生效的 provider 机制是 `provider-container-registry.ts` 的
> 注册表 + `claude.ts`/`openai.ts`/`ollama.ts` 的副作用自注册。下文清单保留原样作为历史记录。

## 一、重要决策

| 决策 | 理由 |
|------|------|
| 所有文件一次性补齐而非分批 | 用户要求按未完成清单"先完成三"，且文件间无强依赖，可并行创建 |
| 恢复乱码文件用 `git checkout 3cc8f4a` | 乱码是 OC 替换时编码损坏，恢复 pre-OC 提交是最干净的方式 |
| 模板系统去 yaml 依赖 | 当前 OC 无 yaml 包，用简单正则解析 frontmatter 替代 |
| backfill 用 `ensureContainerConfig` 而非 `createContainerConfig` | 实际 API 是 `ensureContainerConfig(agentGroupId, provider?)`，幂等更安全 |
| ollama 从 openai.ts 拆出独立文件 | 解耦——openai.ts 不再承载 ollama 注册，清晰分离 |
| 测试 fixtures 用 `setupTestDb` 包装 | 实际项目需要 `initTestDb` + `runMigrations` 两步，fixture 封装简化测试 |

## 二、所遇问题与修复方案

| # | 问题 | 严重性 | 修复方案 |
|---|------|--------|----------|
| 1 | 20+ 个源文件中文乱码（OC 替换时编码损坏） | P0 | 用 `git checkout 3cc8f4a -- <file>` 从 pre-OC 提交恢复，共恢复 37 个文件 |
| 2 | `package.json` 描述字段乱码导致 pnpm 解析失败 | P0 | 重写为正确 UTF-8 中文 |
| 3 | `web/frontend/package.json` 描述字段乱码导致 workspace 解析失败 | P0 | 重写为正确 UTF-8 中文 |
| 4 | `vitest.config.ts` 乱码导致测试无法启动 | P0 | 从 git 恢复 |
| 5 | 新测试文件 `initTestDb` 未运行 migrations，DB 表不存在 | P1 | 创建 `setupTestDb()` fixture 封装 `initTestDb` + `runMigrations` |
| 6 | `backfill-container-configs.ts` 引用不存在的 API（`getAllAgentGroups`/`createContainerConfig`） | P1 | 改为 `listAgentGroups`/`ensureContainerConfig` |
| 7 | `delivery-guard.test.ts` 引用不存在的 API（`action.decide` vs `action.spec.decide`） | P1 | 改为 `action.spec.decide()` |
| 8 | `cli/commands/groups.ts` 调用 `restartAgentGroupContainers` 参数数量错误 | P1 | 补全 `reason` 参数 |
| 9 | `email.ts`/`install-slug.ts` 等多文件乱码导致 typecheck 报错 | P1 | 从 git 恢复 |
| 10 | `container-runner.ts` 等核心文件乱码 | P0 | 从 git 恢复 |

