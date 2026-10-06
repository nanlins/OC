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
| `groups` | `list` `get` `create` `restart` | Agent 群组管理。`create --name X --folder Y --provider openai` |
| `messaging-groups` | `list` `get` | 消息群组（只读） |
| `wirings` | `list` `get` `create` | 接线管理。`create --messaging-group <id> --agent-group <id> --engage pattern` |
| `users` | `list` `get` | 用户（只读） |
| `roles` | `list` `grant` `revoke` | 角色管理 |
| `members` | `list` `add` `remove` | 群组成员 |
| `sessions` | `list` `get` `history` `clear` | 会话。`history` 跨会话翻聊天记录；`clear <id>` 清空该会话上下文 |
| `destinations` | `list` `add` `remove` `verify` | 目的地授权。`add --group <id> --destination <name>`；写后立即重投影并回读校验一致性 |
| `tasks` | `list` `create` `cancel` `pause` `resume` `delete` | 任务管理 |
| `approvals` | `list` `get` `resolve` | 审批管理 |
| `dropped` | `list` | 丢弃消息（只读） |
| `status` | `get` | 宿主健康（pid/启动时间/instance id/项目根/渠道） |
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

基础 URL：`http://127.0.0.1:8080`。鉴权分两档：未配置 `WEB_TOKEN` 时**仅回环可达**（不需要 token，非本机一律 401）；配置了 `WEB_TOKEN` 则恒需 `Authorization: Bearer <WEB_TOKEN>`。

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
pnpm test                    # 主机 vitest（57 文件 / 550 通过 / 6 跳过，数字以 pnpm test 实际输出为准；
                             #  真实 DeepSeek E2E 需 OC_E2E=1 + 密钥）
pnpm typecheck               # 主机 tsc --noEmit
pnpm lint                    # eslint src/ tests/
pnpm format                  # prettier --write
pnpm format:check            # prettier --check
pnpm coverage                # vitest --coverage（@vitest/coverage-v8）

cd container/agent-runner
bun test                     # 容器测试（78 通过 / 1 跳过，以实际输出为准）
bun run typecheck            # 容器 tsc --noEmit

cd web/frontend
pnpm test                    # 前端测试（15 通过）
pnpm build                   # 前端构建
```

## 5. 构建命令

```bash
pnpm build                   # 编译主机 TypeScript -> dist/
pnpm build:container         # 构建 Agent 容器 Docker 镜像
pnpm build:web               # 构建 React 前端 -> web/frontend/dist/
```

## 修改记录

- 2026-10-06：测试命令小节用例数更新为当前真实数字（主机 57 文件/550 通过/6 跳过，容器 78 通过/1 跳过），并注明"以 pnpm test 实际输出为准"防再漂移