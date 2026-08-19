# OC API 参考

> CLI 管理命令、Web REST API、Agent 对话客户端的完整参考。

## 1. CLI 管理命令（`oc`）

```bash
npm run oc -- <resource> <verb> [--flags]
# 或：pnpm oc -- <resource> <verb> [--flags]
```

### 资源列表

| 资源 | 动词 | 说明 |
|------|------|------|
| `groups` | `list` `get` `create` | Agent 群组管理。`create --name X --folder Y --provider openai` |
| `messaging-groups` | `list` `get` | 消息群组（只读） |
| `wirings` | `list` `get` `create` | 接线管理。`create --messaging-group <id> --agent-group <id> --engage pattern` |
| `users` | `list` `get` | 用户（只读） |
| `roles` | `list` `grant` `revoke` | 角色管理 |
| `members` | `list` `add` `remove` | 群组成员 |
| `sessions` | `list` `get` | 会话（只读） |
| `tasks` | `list` `cancel` | 任务管理 |
| `approvals` | `list` `get` `resolve` | 审批管理 |
| `dropped` | `list` | 丢弃消息（只读） |
| `kb` | `add` `sync` | 知识库。`add --kb X --title Y --text Z`；`sync --kb X --group <id>` |
| `eval` | `run` `report` | 评估。`run --kb X`；`report` |
| `help` | -- | 列出所有命令 |

### 示例

```bash
oc groups list
oc groups create --name demo --folder demo --provider openai
oc groups get <group-id>
oc wirings create --messaging-group <mg-id> --agent-group <ag-id>
oc kb add --kb kb --title "退款政策" --text "如何申请退款..."
oc eval run --kb kb
oc help
```

## 2. Web REST API

基础 URL：`http://127.0.0.1:8080`。鉴权：`Authorization: Bearer <token>`（token 在 `data/web-token` 或 `.env` 的 `WEB_TOKEN`）。

### 只读投影

| 端点 | 说明 |
|------|------|
| `GET /api/groups` | Agent 群组列表 |
| `GET /api/messaging-groups` | 消息群组列表 |
| `GET /api/wirings` | 接线列表 |
| `GET /api/sessions` | 会话列表 |
| `GET /api/sessions/:id/messages` | 会话消息列表 |
| `GET /api/approvals` | 审批列表 |
| `GET /api/audit` | 审计记录 |
| `GET /api/usage` | 用量统计 |
| `GET /api/traces/:sessionId` | Agent 轨迹（JSONL） |

### 动作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/approvals/resolve` | POST | 审批决议。`{id, decision: "approve"|"reject"}` |
| `/api/wirings` | POST | 创建接线。`{messagingGroupId, agentGroupId}` |

### SSE 事件

| 端点 | 说明 |
|------|------|
| `GET /events` | 事件直播（`text/event-stream`），发布 `hello` / `test-event` 等 |

### 错误响应

```json
{ "error": "本地化错误文案", "code": "api.err.unauthorized" }
```

状态码：401（未授权）、403（CSRF）、404（未找到）、413（请求体过大）、405（方法不允许）、500（内部错误）。

## 3. Agent 对话

### CLI 通道对话

```bash
pnpm exec tsx scripts/chat.ts "你的消息"
```

连接 CLI 命名管道，发送消息并等待回复。首条回复后静默 3 秒退出。

### 管理工具

```bash
pnpm exec tsx scripts/send-once.ts "init"     # 发一条即退（触发 MG 自动创建）
pnpm exec tsx scripts/set-group-model.ts <group-id> <provider> <model>
pnpm exec tsx scripts/delete-wiring.ts <wiring-id>
```

## 4. 测试命令

```bash
pnpm test                    # 主机 vitest（309 用例）
pnpm typecheck               # 主机 tsc --noEmit
pnpm lint                    # eslint src/ tests/
pnpm format                  # prettier --write
pnpm format:check            # prettier --check

cd container/agent-runner
bun test                     # 容器测试（38 用例）
bun run typecheck            # 容器 tsc --noEmit

cd web/frontend
pnpm test                    # 前端测试（15 用例）
pnpm build                   # 前端构建
```

## 5. 构建命令

```bash
pnpm build                   # 编译主机 TypeScript -> dist/
pnpm build:container         # 构建 Agent 容器 Docker 镜像
pnpm build:web               # 构建 React 前端 -> web/frontend/dist/
```