# OC —— 个人 AI 助手平台

> 用途：OC 项目入口文档——项目简介、快速开始、配置说明、使用示例、架构说明。
> 基线：`nanoclaw` v2（GitHub nanocoai/nanoclaw），从 0 到 1 复刻核心架构并自主扩展。

## 项目简介

OC 是一个**单进程主机 + 每会话隔离容器**的个人 AI 助手平台。主机负责编排、路由、投递与巡检；每个会话跑在独立 Docker 容器里执行 Agent（LLM + 工具）。主机与容器之间**没有 IPC**，唯一 IO 面是每会话两块 SQLite，各文件恰好一个写者，天然并发安全。

在基线之上的自主扩展：Web 管理控制台（React）、9 渠道内置、流式增量投递、RAG（BM25-lite + 可注入向量检索）、评估观测、i18n 三语、聊天斜杠命令与交互式安装向导。

## 快速开始

前置：Node ≥ 20、pnpm、Docker。

```bash
# 1. 安装依赖
pnpm install

# 2. 交互式配置供应商/密钥/模型（写 .env，可选建默认组）
pnpm setup

# 3. 构建 Agent 容器镜像
pnpm build:container

# 4. 启动主机（Web 控制台随主机服务于 http://127.0.0.1:8080）
pnpm start

# 5. 与 Agent 对话（首次冷启动容器约几秒）
pnpm chat
```

不想用交互向导时，可手动复制 `.env.example` 为 `.env` 填写（见配置说明），免 key 体验可在建组时 `--provider mock`。

## 配置说明

秘密只进 `.env`（0600）或进程外注入，不回显、不进 docker argv。三种配置方式（任选）：

1. `pnpm setup` —— 交互式向导（推荐，自动写 `.env` 并建组）
2. chat 内 `/setup <provider> <端点> <密钥> [模型]`（首参为 URL 时默认 openai）
3. 手动编辑 `.env`

`.env` 常用键：

| 键 | 说明 |
|----|------|
| `DEFAULT_AGENT_PROVIDER` | 默认供应商：`openai` / `claude` / `ollama` / `mock` |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | OpenAI 兼容端点密钥与地址（DeepSeek/GLM/Qwen…，如 `https://api.deepseek.com/v1`) |
| `ANTHROPIC_API_KEY` | Claude 密钥 |
| `OLLAMA_HOST` | 本地 Ollama，如 `http://127.0.0.1:11434` |
| `WEB_PORT` | Web 控制台端口（默认 8080） |
| `TZ` / `OC_LOCALE` | 时区 / 宿主 i18n（zh/en/ja） |
| `CONTAINER_*_LIMIT` | 容器 CPU/内存/PID 限额 |

模型按 Agent 组存储：chat 内 `/model <名称>` 切换，或 `pnpm exec tsx scripts/set-group-model.ts <组id> <provider> <模型>`。

## 使用示例

最小可运行示例（终端 REPL）：

```
$ pnpm chat
› 你好，介绍一下你自己
agent 你好！我是你的个人助手，运行在隔离容器里……
› /config
agent 当前配置：组 provider=openai 模型=deepseek-v4-flash ……
› /model deepseek-v4-flash
agent 模型已设为：deepseek-v4-flash（下一条消息生效）
```

非交互一行式（脚本/CI 可用）：

```bash
pnpm exec tsx scripts/chat.ts "你好，介绍一下你自己"
```

开发者示例——给容器注册一个 MCP 工具（`container/agent-runner/src/mcp-tools/` 内，重建镜像后生效）：

```ts
import { registerTools } from "./registry.ts";
registerTools([{
  name: "my_tool",
  description: "示例工具",
  parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  handler: async (args) => ({ ok: true, echo: String(args.q) }),
}]);
```

管理 CLI：`pnpm oc -- groups list` / `pnpm oc -- groups create --name demo --folder demo --provider openai`。

## 架构说明

一句话：**单进程 Node 主机编排"每会话一个 Docker 容器"的 Agent 集群；主机与容器无 IPC，唯一 IO 面是每会话两块 SQLite，各文件恰好一个写者。**

请求流：

```
渠道(Telegram/Discord/…/CLI) → router(engage+门控) → messages_in(inbound.db, 主机写/容器只读)
   → 唤醒容器 → agent-runner poll-loop → LLM + MCP 工具 → messages_out(outbound.db, 容器写/主机只读)
   → delivery(投递+流式合并) → 渠道
```

双 DB 单写者（承重不变量）：

| 文件 | 写者 | 读者 | 内容 |
|------|------|------|------|
| `inbound.db` | 主机 | 容器 | messages_in / delivered / destinations / session_routing |
| `outbound.db` | 容器 | 主机 | messages_out / processing_ack / session_state / container_state |

- `journal_mode=DELETE`（WAL 的 mmap 不跨挂载传播）；主机每次 open-write-CLOSE 使容器页缓存失效。
- 容器沙箱：`--cap-drop=ALL` + `no-new-privileges` + `--init` + 资源限额 + 出口封锁可选；guard fail-closed 授权。
- 崩溃恢复：spawn 前清理残留 journal、integrity 检查、`ensureSessionDbFiles` 防 bind-mount 把缺失 DB 误建为目录。

目录结构（节选）：

| 目录 | 说明 |
|------|------|
| `src/` | 主机：编排/路由/投递/会话/容器运行/CLI/模块 |
| `src/db/` | 中央 DB 层 + 迁移 |
| `src/channels/` | 9 个通道适配器 |
| `container/agent-runner/` | 容器 Agent 引擎（Bun）：poll-loop/provider/MCP 工具/技能/记忆 |
| `web/frontend/` | React 管理控制台 |
| `scripts/` | chat / setup / 运维脚本 |

## 质量与文档

```bash
pnpm typecheck && pnpm lint && pnpm test        # 主机
cd container/agent-runner && bun test           # 容器
```

- `docs/architecture.md` 架构设计 · `docs/security.md` 安全模型 · `docs/api-reference.md` API 参考

## 修改记录

- 2026-09-01 重写：收束为简介/快速开始/配置/示例/架构五板块，对齐阶段 12-15 现状（setup 向导、斜杠命令、stream_final、DB 恢复修复）
