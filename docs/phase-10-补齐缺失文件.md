# phase-10-补齐缺失文件

> 阶段：补齐设计文档要求的所有缺失文件（30 项），同时修复因 OC 替换导致的乱码问题。

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

## 三、对标 claw 开源源码完成度

| 模块 | nanoclaw 文件 | OC 状态 | 备注 |
|------|-------------|---------|------|
| `claude-md-compose.ts` | 170 行，persona + shared base + skills + MCP 片段 | 已复刻（简化） | 去 group-persona、去 OneCLI 片段 |
| `upgrade-state.ts` | 126 行，version marker + tripwire | 已复刻 | 简化 CLI 修复提示 |
| `backfill-container-configs.ts` | 79 行，旧 JSON → DB 回填 | 已复刻 | 去 OneCLI/MCP 复杂字段 |
| `response-registry.ts` | 34 行，简单注册表 | 已复刻 | 同构 |
| `channels/ask-question.ts` | 53 行，选项标准化 | 已复刻 | 同构 |
| `providers/factory.ts` | — | 自主实现 | nanoclaw 无主机侧工厂 |
| `providers/types.ts` | — | 自主实现 | ProviderConfig 集合 |
| `providers/ollama.ts` | — | 自主实现 | 从 openai.ts 拆分 |
| `cli/delivery-action.ts` | — | 自主实现 | 极简注册表 |
| `cli/commands/` | 目录结构 | 自主实现 | 6 个命令文件 |
| `templates/create-agent.ts` | 110 行 | 已复刻（简化） | 去 yaml/OneCLI/group-persona/task 创建 |
| `templates/parse.ts` | 166 行 | 已复刻（简化） | 去 yaml 依赖，用正则解析 |
| `templates/local-dir.ts` | 33 行 | 已复刻 | 同构 |
| `db/dropped-messages.ts` | — | 自主实现 | 基于 unregistered_senders 表 |
| `agent-runner upload-trace.ts` | — | 自主实现 | JSONL 轨迹上传 |
| `agent-runner session-routing.ts` | — | 自主实现 | 读/写 session_routing |
| `agent-runner ollama.ts` | — | 自主实现 | 容器侧 OpenAI 兼容调用 |
| `agent-runner session-hook.ts` | — | 自主实现 | 记忆注入系统提示 |
| `entrypoint.sh` | — | 自主实现 | 兜底启动脚本 |
| `install-cli-tools.sh` | — | 自主实现 | apt 工具安装 |
| `cli-tools.json` | — | 自主实现 | 工具清单 |
| `pull.sh` | — | 自主实现 | 镜像拉取 |
| fixtures | — | 自主实现 | mock-provider/adapter/memory-db |
| 测试文件 | — | 自主实现 | container-config/delivery-guard/messaging-groups/e2e |

## 四、扩展度

| 扩展 | 来源 | 说明 |
|------|------|------|
| mount-security 模块接入 barrel | 05-后端工程详解 §4.3 | 挂载安全在模块注册表中缺失，已补入 |
| ollama 独立文件 | 04-Agent应用详解 §3.2 | Provider 解耦，openai.ts 不再承载 ollama |
| CLI 命令子目录 | 07-OpenClaw详细设计文档 §8 | 按文档预期创建 commands/ 子目录含 6 个命令文件 |
| 模板系统 | 07-OpenClaw详细设计文档 §8 | 模板解析 + stamping 实现 |
| 升级 tripwire | 05-后端工程详解 §5.2 | 启动安全守卫 |
| 测试 fixtures | 07-OpenClaw详细设计文档 §12 | mock-provider/adapter/memory-db 三件套 |

---

## 修改记录
- 2026-08-24 创建（阶段 10：补齐缺失文件）