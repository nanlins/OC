# OC 架构设计

> 说明 OC 的核心架构设计：单进程主机编排、双 DB 会话模型、请求流、容器隔离、模块化扩展。

## 1. 一句话架构

单进程 Node 主机编排"每会话一个 Docker 容器"的 Agent 集群。主机与容器之间**没有 IPC**，唯一 IO 面是每会话两块 SQLite——`inbound.db`（主机写/容器只读）和 `outbound.db`（容器写/主机只读），各文件恰好一个写者。

## 2. 实体模型

```
users (id "<channel>:<handle>", kind, display_name)
  |- user_roles (user_id, role, agent_group_id) -- owner | admin
  |- agent_group_members (user_id, agent_group_id) -- unprivileged access gate

agent_groups (id, name, folder, agent_provider)
  <-> messaging_group_agents (wiring: session_mode, engage_mode, priority)

messaging_groups (id, channel_type, platform_id, instance)
  |- sessions (agent_group_id + messaging_group_id + thread_id)
```

## 3. 双 DB 会话模型

每个会话有两个 SQLite 文件，精确一个写者：

| 文件 | 写者 | 读者 | 内容 |
|------|------|------|------|
| `inbound.db` | 主机 | 容器（只读） | `messages_in`、`delivered`、`destinations`、`session_routing` |
| `outbound.db` | 容器 | 主机（只读） | `messages_out`、`processing_ack`、`session_state`、`container_state` |

**三条承重不变量**：
1. `journal_mode=DELETE` -- WAL 的 mmap -shm 在 VirtioFS 上不跨挂载传播
2. 主机每次操作 `open-write-CLOSE` -- 长连接会冻结容器视图
3. 主机偶数 `seq` / 容器奇数 `seq` -- 双车道隔离，永不冲突

心跳是文件 touch（`/workspace/.heartbeat`），不是 DB 写。

## 4. 请求流

```
用户消息 -> 通道适配器接收 -> Router 路由
  -> messaging_group 解析（平台 ID -> 群组行）
  -> 发送者解析（upsert users）
  -> wiring 匹配（messaging group -> agent group）
  -> 访问门控（permissions guard）
  -> session 解析（按 session_mode 创建/复用）
  -> 写 messages_in -> inbound.db
  -> wakeContainer() 唤醒 Docker 容器
  -> Agent Runner 轮询 inbound.db -> 格式化 -> Provider 调用 LLM
  -> 写 messages_out -> outbound.db
  -> 主机 delivery 轮询 outbound -> 通道适配器投递 -> 用户
```

## 5. 容器隔离

- Docker 容器，每会话独立：`--cap-drop=ALL --security-opt=no-new-privileges --init`
- 文件系统隔离：只挂载显式指定路径（`/workspace`、`/workspace/agent`、`inbound.db`、`outbound.db`）
- 资源限制：`--cpus`、`--memory`、`--pids-limit`
- Agent 运行在 Bun 运行时，不依赖 tsc 编译（`bun run /app/src/index.ts`）
- 密钥经 `--env-file`（0600）注入，不进 docker run argv

## 6. 模块化扩展

核心是"注册表 + 钩子"模式：
- **通道适配器**：自注册（`registerChannelAdapter`），`onInbound` 回调注入
- **模块**：`permissions`/`approvals`/`scheduling`/`a2a`/`self-mod`/`memory-kb` 经 barrel 副作用注册钩子
- **Provider**：`registerProviderContainerConfig` 注册容器贡献（env/挂载）
- **CLI 命令**：`registerCommand` 声明式注册，scope 控制权限
- **技能**：`nc:` 指令引擎（copy/append/env-set），幂等安装

核心代码不直接调用模块，通过注册的回调。未安装模块时核心降级运行。

## 7. 自主扩展（相对 nanoclaw 基线）

1. Web 管理控制台 + React 前端：REST API + SSE 事件直播 + 6 页面管理 UI + 三语 i18n
2. 评估与观测体系：检索指标 + Judge（Mock/Llm）+ 拒答统计 + 轨迹 JSONL
3. RAG（memory-kb）：分块检索 + 可注入 embedding 向量检索 + `kb_search` 接入 agent
4. 9 渠道内置：Telegram/Discord/Slack/飞书/钉钉/企微/Email/Webhook/CLI
5. openai/ollama provider 内置 + mock provider 免 key 端到端
6. 20 容器技能
7. 流式增量投递：provider 流式解码 + poll-loop 编辑式增量 + telegram editMessageText