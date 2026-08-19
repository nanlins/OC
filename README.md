# OC —— 个人 AI 助手平台

> 从 0 到 1 复刻 nanoclaw v2 核心架构，并做自主扩展：Web 控制台/React 前端/评估观测/i18n/RAG/9 渠道内置/流式增量投递。
> 基线：`nanoclaw`（GitHub nanocoai/nanoclaw）。

## 架构一句话

单进程 Node 主机编排"每会话一个 Docker 容器"的 Agent 集群。主机与容器之间**没有 IPC**，唯一 IO 面是每会话两块 SQLite——`inbound.db`（主机写/容器只读）和 `outbound.db`（容器写/主机只读），各文件恰好一个写者。

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置 .env（复制 .env.example 为 .env，填 LLM 凭据）
#    OpenAI 兼容端点（DeepSeek/GLM/Qwen...）：
#    OPENAI_API_KEY=sk-xxx
#    OPENAI_BASE_URL=https://api.deepseek.com/v1
#    免 key 体验：建组时 --provider mock（纯 echo，验证全链路）

# 3. 构建 Agent 容器镜像
pnpm build:container

# 4. 启动（单入口，Web 控制台随主机服务于 http://127.0.0.1:8080）
pnpm start

# 5. 构建前端（React 产物由主机 8080 直接服务，无需单独跑前端）
pnpm build:web

# 6. 与 Agent 对话
pnpm exec tsx scripts/chat.ts "你好，介绍一下你自己"

# 7. 管理 CLI
pnpm oc -- groups list
pnpm oc -- groups create --name demo --folder demo --provider openai
pnpm oc -- help
```

首次对话会冷启动容器（约几秒）。详细 API 参考见 `docs/api-reference.md`。

## 目录结构

| 目录 | 说明 |
|------|------|
| `src/` | 主机源码：入口编排、路由、投递、会话管理、容器运行、巡检、CLI、guard、模块 |
| `src/db/` | 中央 DB 层：连接管理、表结构、迁移系统、各表 CRUD |
| `src/db/migrations/` | 迁移运行器（name 去重 + FK 安全协议 + 001 初始迁移） |
| `src/channels/` | 9 个通道适配器（Telegram/Discord/Slack/飞书/钉钉/企微/Email/Webhook/CLI） |
| `src/cli/` | CLI 管理工具：帧协议、命令注册表、dispatch 分发器、CRUD 生成器、socket 服务 |
| `src/guard/` | guard fail-closed 授权：决策函数、动作值、类型定义 |
| `src/providers/` | Provider 主机侧容器贡献（openai/claude 密钥注入） |
| `src/modules/` | 11 个模块：权限、审批、调度、A2A、交互、自改、RAG(memory-kb)、挂载安全、观测、配额、打字 |
| `src/eval/` | 评估体系：检索指标、Judge（Mock/Llm）、轨迹 JSONL、语料生成 |
| `src/i18n/` | 三语运行时（zh/en/ja）：t/negotiateLocale/LocalizedError |
| `src/web/` | Web 管理控制台：REST API（fail-closed 鉴权+CSRF+413）、SSE 事件、静态服务 |
| `src/skills/` | nc: 指令引擎：语法解析、策略引擎、安装执行器 |
| `src/setup/` | 安装向导（environment/timezone/set-env/verify 四步） |
| `container/` | Docker 镜像构建脚本 + Dockerfile（oven/bun:debian + 源码/技能烘焙） |
| `container/agent-runner/src/` | Agent 执行引擎（Bun）：轮询循环、格式化、Provider 抽象、MCP 工具、KB 检索、技能、记忆 |
| `container/agent-runner/src/db/` | 容器会话 DB：连接管理、入站/出站读写、会话状态、表结构 |
| `container/agent-runner/src/providers/` | 容器侧 Provider：claude/openai（流式）/ollama/mock + 工具循环 |
| `container/agent-runner/src/mcp-tools/` | MCP 工具集：出站四件套、文件/Bash、交互/调度/Web、kb_search |
| `container/skills/` | 20 个容器技能（SKILL.md） |
| `scripts/` | 运维脚本：chat/send-once/set-group-model/delete-wiring/kb 管理 |
| `tests/` | 主机测试（309 用例）：单元/集成/eval |
| `web/frontend/` | React 前端（Vite 7）：6 页面管理控制台 + 三语 i18n + SSE 事件直播 |
| `bin/` | CLI 入口（oc） |
| `docs/` | 项目文档：架构设计、安全模型、API 参考 |

## 质量命令

```bash
pnpm typecheck && pnpm lint && pnpm test   # 主机：tsc + eslint + vitest（309 用例）
cd container/agent-runner && bun test       # 容器：bun test（38 用例）
pnpm format:check                           # prettier 格式检查
```

## 诚实口径

- **RAG**：关键词召回（BM25-lite）+ 可注入 embedding 向量检索（cosine + 阈值拒答），`kb_search` 已接入 agent。未使用 sqlite-vec/pgvector，embedding 生产需接真实 API（接口已留）。
- **密钥模型**：`.env` -> 0600 env-file 注入容器（不进 docker argv）。弱于基线 OneCLI 网关的"token 不进容器"，属已记录的取舍。
- **流式**：provider 层流式 + 编辑式增量投递（telegram 支持 editMessageText；其余渠道 operation/editTarget 已透传）。
- **测试**：全 Mock，不真调 LLM/Docker/网络；真实 DeepSeek 端到端手工跑通。

## 更多文档

- `docs/architecture.md` -- 架构设计：实体模型、双 DB 会话、请求流、容器隔离、模块化
- `docs/security.md` -- 安全模型：guard fail-closed、容器沙箱、Web 安全、密钥管理、审批流
- `docs/api-reference.md` -- API 参考：CLI 命令、Web REST API、Agent 对话、测试与构建命令