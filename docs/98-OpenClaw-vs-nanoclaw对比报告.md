# OpenClaw vs nanoclaw 对比报告（最新 main 刷新版）

> 用途：逐模块对比 OpenClaw（本项目，手搓复刻）与基线 nanoclaw（`../nanoclaw/`，GitHub `nanocoai/nanoclaw` 最新 main，commit `639577c3`）。说明复刻保留、nanoclaw 更强处、OpenClaw 自主扩展与设计哲学差异。基线为 trunk；nanoclaw 具体渠道/非默认 provider 在 `channels`/`providers` 分支经技能装入，不在 trunk。

## 一、规模与栈（实测）
| 维度 | nanoclaw（最新 main） | OpenClaw |
|---|---|---|
| 主机 src（非测试） | 150 文件 / 18,396 行 | 93 文件 / 约 8.5k 行 |
| 主机测试文件 | 72 | 36（290 用例） |
| 容器 agent-runner src | 33 文件 / 4,309 行 | 约 2.3k 行 |
| **安装向导 setup** | **68 文件 / 14,145 行 / 25 步** | 约 4 步（environment/timezone/set-env/verify） |
| 运行时 | Node 主机 + Bun 容器 | 同 |
| 容器技能 | 5 | 20 |
| 渠道（trunk 内置） | cli + chat-sdk-bridge + ask-question（余者分支装入） | 9 内置 |
| ncl 资源数 | 14 | 约 11 |
| Web 控制台 / 前端 / 评估 / i18n | 无 | 有 |

> 关键观察：**nanoclaw 的最大代码投入是安装向导（14k 行，几乎等于 OpenClaw 整个 src）**——OneCLI 接入、Telegram/WhatsApp/Signal 配对、镜像 registry 登录、service 安装等 25 步。这是 OpenClaw 未复刻、也最不该复刻（平台绑定、运维向）的部分。

## 二、逐模块对比
| 模块 | nanoclaw | OpenClaw | 结论 |
|---|---|---|---|
| 实体模型（users/roles/groups/wiring/sessions/user_dms） | ✅ | ✅（无 user_dms 冷 DM 缓存） | 基本复刻 |
| 双 DB 会话（inbound/outbound，单写者，even/odd seq） | ✅ | ✅ | 已复刻（承重不变量） |
| 中央 DB + 迁移（name 去重 + FK 安全协议） | ✅ | ✅ | 已复刻 |
| router / command-gate / delivery / delivery-guard / host-sweep | ✅ | ✅ | 已复刻 |
| guard（guard/guard-actions/types/index 四件） | ✅ | ✅ 同名同构 | 已复刻 |
| 模块 permissions/approvals/scheduling/a2a/interactive/self-mod/typing/mount-security | ✅ | ✅ | 已复刻 |
| 模块 memory-kb / observability / quota | ❌ | ✅ | OpenClaw 新增 |
| CLI dispatch/crud/frame | ✅ | ✅ | 已复刻 |
| ncl 资源广度 | 14（含 destinations/policies/user-dms/tasks 全 CRUD/groups config+restart） | 约 11（无 destinations/policies/user-dms） | nanoclaw 更广 |
| 容器运行时（Docker + Bun + provider 抽象 + MCP） | ✅ | ✅ | 已复刻 |
| 容器 provider（trunk） | claude + mock | claude/openai/ollama/mock | OpenClaw 更宽 |
| 技能引擎（SKILL.md + nc: 指令 + skill-apply） | ✅ | ✅ | 已复刻并产品化 |
| chat-sdk-bridge（通用 Chat SDK 渠道桥） | ✅ | ❌ | nanoclaw 独有 |
| 渠道适配器 | 分支技能装入（17+ 可装） | 9 内置 | 形态不同（§五） |
| Provider 密钥 | OneCLI 网关 | 直连 .env（无 OneCLI） | 简化（§四） |
| 模板 templates / worktree / 远程 MCP / Tavily | ✅（近期新增） | ❌ | nanoclaw 独有 |
| Web 控制台 / React 前端 / 评估观测 / i18n | ❌ | ✅ | OpenClaw 自主扩展 |

## 三、承重设计（复刻保留，未退化）
1. **双 DB 单写者**：inbound 主机写/容器读、outbound 容器写/主机读；`journal_mode=DELETE`、open-write-close、even/odd seq。
2. **帧不携带身份**：caller 由传输适配器带外填充。
3. **guard fail-closed**：grant 只满足 hold 永不松动 deny；审批重放携带活行 grant 复核。
4. **迁移 FK 协议**：事务外切 `foreign_keys=OFF` + 事务内差分新违规回滚。
5. **挂载白名单在项目根外**、秘密不进容器 env、fs 沙箱 safeJoin。

## 四、密钥/Provider 模型差异（最大取舍）
- **nanoclaw**：真实 token 永不进容器；OneCLI Agent Vault 独立 secret-proxy 网关在 wire 上改写 `Authorization` 头；审批策略经 OneCLI Web UI（127.0.0.1:10254）。强隔离，但多一个服务、Unix 生态、Windows 不可用。
- **OpenClaw**：主机侧 provider 直连，密钥经 `.env` 白名单读取后以 `-e` 显式注入容器（不靠环境继承、不写宿主 process.env）。放弃 OneCLI，换可移植与简洁；隔离强度弱于基线（已声明）。

## 五、渠道模型差异
- **nanoclaw**：trunk 仅注册表 + `chat-sdk-bridge`（通用桥）+ cli；具体渠道在 `channels` 分支经 `/add-<channel>` 技能 `git fetch`+拷贝+装依赖接入。极简、可插拔、生态广（17+）。
- **OpenClaw**：9 渠道（telegram/discord/slack/feishu/dingtalk/wecom/email/webhook/cli）内置 `src/channels/`，统一 `ChannelAdapter` 透传（适配器零文案，本地化收敛上游）。开箱即用，无分支装配；但无 chat-sdk-bridge 这类通用桥。

## 六、OpenClaw 自主扩展（基线无）
1. **Web 管理控制台**（阶段 9）+ **React 全量前端**（阶段 11，6 页面 + 三语 i18n）。
2. **评估与观测**（阶段 12）：轨迹 JSONL、RAG 评估 harness、Mock/Llm Judge、回归集。
3. **i18n 三语全链路**（阶段 14）：zh/en/ja × CLI/Web/渠道/前端。
4. **memory-kb（RAG）/ observability / quota 模块**、**容器技能库扩至 20**、**mock provider 免 key 端到端**。
5. **openai/ollama provider 内置**（基线 trunk 仅 claude+mock）。

## 七、nanoclaw 更强 / OpenClaw 差距（诚实记账）
1. **安装向导**：nanoclaw 25 步/14k 行（OneCLI、渠道配对、registry、service）；OpenClaw 仅 4 步基础体检。
2. **ncl 广度**：nanoclaw 多 `destinations`、`policies`、`user-dms`、`dropped-messages`，`tasks` 全 CRUD，`groups config/restart`；OpenClaw 缺 destinations/policies/user-dms。
3. **密钥隔离**：OneCLI 网关 > 直连 .env。
4. **审批选项**：nanoclaw `{label, selectedLabel, value}` 分离；OpenClaw 纯字符串（接渠道审批按钮前需分离）。
5. **chat-sdk-bridge / templates / worktree / 远程 MCP / Tavily** 等新特性 OpenClaw 未跟进。
6. **渠道生态**：分支可装 17+ vs 内置 9。
7. **容器镜像**：nanoclaw 含 chromium/浏览器自动化、CJK 字体开关、cli-tools.json 供给链；OpenClaw 为精简运行时镜像。

## 八、结论
OpenClaw 在**承重架构上忠实复刻** nanoclaw（双 DB / 帧外身份 / guard / 迁移 FK / 容器编排 / CLI / 技能引擎），**功能面做宽**（9 渠道内置、Web 控制台、React 前端、评估、i18n、20 技能、openai/ollama），**密钥与安装面做简**（去 OneCLI、去 25 步向导）。nanoclaw 核心 src 约为 OpenClaw 2 倍，体量主要来自**安装向导与更广的 ncl/渠道生态**；OpenClaw 更自包含、可移植（Windows 可跑）、管理与观测面更完整。二者是「成熟可插拔基线」与「自包含教学扩展实现」的关系。

## 修改记录
- 2026-08-13 创建（收束期对比，基于旧版源码）。
- 2026-08-13 刷新：改用 GitHub 最新 main（`639577c3`）实测；补 setup 14k 行/25 步、ncl 14 资源、chat-sdk-bridge、容器 provider 与近期特性（worktree/Tavily/远程 MCP）对比。
