# fix-plan-90 —— 修复计划与真实完成状态

> 用途：对照 Codex 修复清单与双检查员（se-inspector / ai-inspector）结论，逐条记录修复计划、优先级与**真实完成状态**。所有"已完成"均附回归测试并可复跑；未接通项如实标注，不以文档措辞冒充。
> 事实基准：当前源码为唯一事实；`docs/` 阶段文档仅作线索。

## 0. 本轮验证命令与结果（实测）

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 通过 |
| `npx eslint src/ tests/` | ✅ 通过（项目 lint 标准） |
| `npx vitest run`（主机） | ✅ 37 文件 / **301 用例** 全绿 |
| `bun test`（容器 agent-runner） | ✅ **30 通过** / 1 skip |
| 前端 `typecheck` + `test` + `build` | ✅ tsc 通过 / 15 用例 / 构建成功 |
| `npx prettier --check` | ⚠️ 63 个历史文件未格式化（未做大规模重排，见 §4） |

## 1. P0 修复（全部完成并有回归测试）

| # | 问题 | 状态 | 代码证据 | 测试证据 |
|---|---|---|---|---|
| P0-1 | `/api/traces/:id` 路径穿越 | ✅ 已修 | `src/eval/trace.ts:27` `isSafeTraceId`（拒绝分隔符 + resolve 容纳校验）；`src/web/api.ts` traces 端点解码后校验、非法回 400 | `tests/unit/trace-safety.test.ts`（7 断言）+ `web.test.ts` traces 穿越回归 |
| P0-2 | `WEB_TOKEN` 空时全开放 | ✅ 已修 | `src/web/api.ts` `getOrInitWebToken`（未配置则生成随机 token 持久化 `DATA_DIR/web-token`，fail-closed）；`authorized` 恒要求有效 Bearer | `web.test.ts` "fail-closed auth" 回归（无 token/错 token → 401） |
| P0-3 | Web 变更接口无 CSRF/Origin | ✅ 已修 | `src/web/api.ts` `csrfOk`（拒绝 Sec-Fetch-Site=cross-site 与 Origin≠Host），POST 前置校验回 403 | `web.test.ts` "CSRF cross-site Origin" 回归 |
| P0-4 | Agent 不加载 CLAUDE.md | ✅ 已修 | `container/agent-runner/src/claude-md.ts`（读取+预算截断）；`index.ts` 注入系统提示 | `claude-md.test.ts`（5 用例） |
| P0-5 | 工具路由上下文恒 null | ✅ 已修 | `index.ts` `ctxFactory(routing?)`；`claude.ts`/`openai.ts` 工具调用传 `input.routing`；`providers/registry.ts` 工厂签名 | `openai.test.ts` "passes batch routing into tool context" 回归 |
| P0-6 | mcpServers/packages 批准后不生效 | ⚠️ 诚实降级 | `src/modules/self-mod.ts` applyInstall/applyAddMcp 改为**配置级**生效并如实标注（不再谎称"已安装/已接入"） | 无运行时热安装；真实安装/接入列入未完成（§5） |

## 2. P1 修复

| # | 问题 | 状态 | 代码证据 | 测试证据 |
|---|---|---|---|---|
| P1-1 | SMTP 587 明文发密码 | ✅ 已修 | `src/channels/email.ts` 465 隐式 TLS；非 465 必须 STARTTLS 升级（验证证书）否则拒绝认证，凭据不走明文 | `email.test.ts` 465 握手 + "587 无 STARTTLS 拒绝且不泄露凭据" 回归 |
| P1-2 | `cleanupOrphans` 从未调用 | ✅ 已修 | `src/index.ts` 启动/关停各调用 `cleanupOrphans(new Set())` | 既有 container-runtime 测试覆盖清理逻辑 |
| P1-3 | `routeInbound` 无 `.catch` | ✅ 已修 | `src/index.ts` onInbound/onInboundEvent 均 `.catch` 记日志，主机不退出 | 结构修复（错误边界） |
| P1-4 | Webhook/飞书/钉钉/企微入站未接线 | ⚠️ 部分 | webhook-generic 有入站路由；feishu/dingtalk/wecom 为**出站优先**，入站回调+签名校验未接通 | 列入未完成（§5）；文档标注 outbound-only |
| P1-5 | Telegram 普通群 @Bot 不识别 | ❌ 未修 | 需拉取并校验 bot username + text_mention 处理 | 列入未完成（§5） |
| P1-6 | `request_approval` 只记录不审批 | ⚠️ 重定性 | agent-runner **无 request_approval 工具**；宿主侧审批（guard/self-mod/cli_command）闭环可用（`web.test.ts` approve 回归） | agent 面向的 request_approval 工具不存在，列为缺口而非"只记录" |
| P1-7 | `readBody` 超限仍累积 | ✅ 已修 | `src/web/api.ts` 超限停止累积返回 null，调用方回 413 | `web.test.ts` "oversized POST body returns 413" 回归 |
| P1-8 | API key 进 `docker run -e` argv | ✅ 已修 | `container-runner.ts` 密钥写 0600 临时文件经 `--env-file` 注入（不进 argv），容器退出删除 | `container-runner.test.ts` env-file 回归（密钥不在 argv） |

## 3. P2 修复

| # | 问题 | 状态 | 证据 |
|---|---|---|---|
| P2-1 | 测试被 `.env` 的 `OC_LOCALE` 污染 | ✅ 已修 | `i18n/index.ts` `resolveLocaleFromEnv` 显式入参优先 + configLocale 参数化；`i18n.test.ts` 隔离断言，全套绿 |
| P2-2 | CI 工作流 | ✅ 已建 | `.github/workflows/ci.yml`（typecheck/lint/format/host/frontend/container 六任务） |
| P2-3 | React 生产构建接入主机静态目录 | ❌ 未做 | `build:web` + 安全复制未实现（前端仍可 vite dev / 独立 build）；列入未完成 |

## 4. 明确不做 / 降级项（对齐 Codex"明确不复制项"）
- **OneCLI 密钥网关**、**平台绑定安装向导**、**Unix 服务安装（launchd/systemd）**、**非 Windows 生态**：与本项目定位无关，不计入分母。
- **prettier 全量重排**：63 个历史文件未格式化；为避免巨量噪声 diff 未执行批量 `--write`，如实记录（CI 的 format 任务会在首次全量格式化后转绿）。

## 4.5 本轮追加完成（RAG / 流式 / build:web）
| 项 | 状态 | 代码证据 | 测试证据 |
|---|---|---|---|
| RAG embedding | ✅ | `memory-kb.ts` 可注入 `EmbedFn` + `kb_embeddings` 表 + `indexDocument` + `searchKbVector`（cosine + 阈值，无 embedder 回退关键词） | `tests/unit/rag-vector.test.ts`（3 用例，确定性假 embedder） |
| kb_search 接入 agent | ✅ | `container/.../mcp-tools/kb-search.ts` 容器内 KB 检索工具（分块+CJK bigram+覆盖率+引用溯源），`bootstrapTools` 注册 | `kb-search.test.ts`（5 用例，bun） |
| Provider 流式 | ✅ | `openai.ts` `stream:true` 增量解码，自动检测流/非流；content 增量 yield progress，tool_calls 按 index 累积 | `openai.test.ts` 流式 2 用例（内容流 + 流式工具调用） |
| React build:web | ✅ | `package.json build:web`；`web/server.ts resolveStaticDir` dist 优先 + MIME 扩充 | `web.test.ts` build:web 回归 |
| 宿主/容器 KB 同步 | ✅ | `memory-kb.exportKbToDir`（物化 KB 为 md，空 KB 不误删）；容器 spawn 自动同步到群组 `kb/`；CLI `kb add`/`kb sync` | `rag-vector.test.ts` exportKbToDir 2 用例 |
| 流式端到端增量投递 | ✅ | 容器 poll-loop 流式写"首条+节流 edit"（in_reply_to 指首条）；delivery 从 delivered 解析 editTarget；telegram `editMessageText` 应用 | poll-loop 流式用例（bun）+ telegram edit 2 用例 |

> kb_search 架构说明：agent 在容器、与宿主中央 DB 隔离，故 kb_search 检索容器工作区 KB 目录（`OPENCLAW_KB_DIR` 或 `/workspace/agent/kb`）为同步 in-container 工具；宿主 `memory-kb`（含 embedding）经 `exportKbToDir` 同步到群组 kb/ 目录，容器 kb_search 读取——两者已打通。
> 流式投递说明：provider 层流式（stream:true）→ poll-loop 写首条消息 + 节流 edit → delivery 解析 editTarget → 渠道 editMessageText。当前 telegram 完整支持 edit；其余渠道 edit 落地为各自适配器的增量工作（operation 已透传）。

## 5. 仍未完成清单（诚实记账，见 benchmark-90 §5）
1. packages/mcpServers 运行时真实安装与 MCP client 接入（当前配置级）。
2. 飞书/钉钉/企微入站回调 + 签名/来源校验（当前出站优先）。
3. Telegram 普通群 @Bot / text_mention 识别。
4. agent 面向 `request_approval` 工具（当前无此工具）。
5. prettier 全量格式化（63 文件）。
6. telegram 之外渠道的 edit 增量落地（operation/editTarget 已透传，各渠道 editMessage 等价 API 为增量工作）。

## 修改记录
- 2026-08-14 创建（fix-plan 执行记录；P0 全修、P1 大部分修、诚实降级与未完成清单留档）。
- 2026-08-14 追加：RAG embedding / kb_search 接入 agent / Provider 流式 / React build:web 完成（§4.5）。
- 2026-08-14 再追加：宿主/容器 KB 同步（exportKbToDir + spawn 自动同步 + CLI kb add/sync）与流式端到端增量投递（poll-loop edit + delivery editTarget + telegram editMessageText）完成；主机 309 用例、容器 38、前端 15+build 全绿。
