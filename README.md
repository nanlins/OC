# OpenClaw —— 手搓个人 AI 助手平台

> 用途：从 0 到 1 复刻 nanoclaw v2 核心架构的 AI Agent 平台，并做自主扩展（Web 控制台/React 前端/评估观测/i18n/RAG/9 渠道内置）。
> 需求与设计：`../docs/07-OpenClaw详细设计文档.md`；基线源码：`../nanoclaw/`（GitHub nanocoai/nanoclaw）。
> 对标结论：`docs/benchmark-90.md`（核心运行时逐模块对标，未完成清单如实留档）。

## 架构一句话

单进程 Node 主机编排「每会话一个 Docker 容器」的 Agent 集群；主机与容器之间**没有 IPC**，唯一 IO 面是每会话两块 SQLite（inbound.db 主机写/容器只读，outbound.db 容器写/主机只读），各文件恰好一个写者。

## 三大承重不变量

1. `journal_mode=DELETE`（WAL 的 mmap -shm 不跨挂载传播）
2. 主机每次操作 open-write-CLOSE（长连接会冻结容器视图）
3. 每 DB 文件恰好一个写者（DELETE 模式 journal unlink 跨挂载非原子）

## 目录结构（注释见各目录 README.md）

| 目录 | 用途 |
|------|------|
| `src/` | 主机源码：路由/投递/会话/容器/巡检/CLI/guard/模块/i18n |
| `container/agent-runner/` | 容器内 Agent 执行引擎（Bun，独立包树） |
| `container/skills/` | 容器技能（20 个） |
| `tests/` | 单元/集成/eval 测试（309 用例） |
| `scripts/` | 运维脚本（chat/send-once/kb 等） |
| `web/` + `src/web/` | Web 管理控制台（React 前端 + REST/SSE API） |
| `docs/` | 项目文档体系（阶段记录/验收/对标/fix-plan） |

## 技术栈

TypeScript 5.7+ · Node 20+（主机）· Bun（容器）· pnpm · better-sqlite3（核心）· Docker · Vitest · ESLint 9 + Prettier 3 · GitHub Actions（CI：typecheck/lint/format/host/frontend/container）

## 快速开始（可运行）

```bash
# 1. 安装依赖
pnpm install

# 2. 配置（.env 已 gitignore）
#    复制 .env.example 为 .env，填 LLM 凭据；二选一：
#    a) OpenAI 兼容端点（DeepSeek/GLM/Qwen…）：
#       OPENAI_API_KEY=sk-xxx
#       OPENAI_BASE_URL=https://api.deepseek.com/v1
#    b) 免 key 体验（mock provider，纯 echo，验证全链路）：
#       建组时用 --provider mock

# 3. 构建 agent 容器镜像（仅容器代码变更后需重跑）
pnpm build:container

# 4. 启动主机（单入口，Web 控制台随主机服务于 http://127.0.0.1:8080）
pnpm dev

# 5. 构建并接入 React 前端（产物由主机直接服务；开发热更新另开 vite dev）
pnpm build:web

# 6. 与 agent 对话（DeepSeek 实测可用）
pnpm exec tsx scripts/chat.ts "你好，介绍一下你自己"

# 7. 管理 CLI
pnpm oc -- groups list
pnpm oc -- groups create --name demo --folder demo --provider openai
pnpm oc -- kb add --kb kb --title "退款政策" --text "如何申请退款：请在设置页提交。"
pnpm oc -- kb sync --kb kb --group <群组id>
```

首次与 agent 对话会冷启动容器（约几秒）；`dstest` 示例群组（DeepSeek `deepseek-v4-flash`）已接线到 cli 通道。

## 质量命令

```bash
pnpm typecheck && pnpm lint && pnpm test   # 主机（309 用例）
cd container/agent-runner && bun test       # 容器（38 用例）
pnpm build:web && pnpm build:container      # 构建
pnpm format                                # prettier 全量格式化
```

## 诚实口径（面试前必读）

- **RAG**：关键词召回（CJK bigram BM25-lite）+ 可注入 embedding 向量检索（cosine + 阈值拒答），`kb_search` 已接入 agent；**未使用 sqlite-vec/pgvector**，embedding 生产需接真实 embedding API（接口已留）。
- **密钥模型**：`.env` → 0600 env-file 注入容器（不进 docker argv）；弱于基线 OneCLI 网关的"token 不进容器"，属已记录的取舍。
- **流式**：provider 层流式（stream 增量解码）+ 编辑式增量投递（telegram 支持 editMessageText；其余渠道 operation/editTarget 已透传）。
- **未完成项**：`docs/fix-plan-90.md` §5（渠道入站接线/packages 热装/ncl 广度等）。

## 修改记录

- 2026-08-12 创建（阶段 0：骨架 + 配置）
- 2026-08-12 package.json 增加 pnpm.onlyBuiltDependencies=["esbuild"]（用户批准）
- 2026-08-14 fix-plan 收尾：删除代码量目标；修正 sqlite-vec 失实声明；重写快速开始；补充诚实口径
