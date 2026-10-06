# cli

> 用途：CLI 管理工具（oc）——socket 服务端、传输无关 dispatcher、泛型 CRUD 框架、cli_scope 执行、服务端渲染的终端输出

## 内容清单
- `frame.ts`：CLI 线上协议帧（RequestFrame/ResponseFrame 行分隔 JSON + CallerContext 带外身份）
- `registry.ts`：命令注册表（registerCommand + scope + agentVisible + description/flags 元数据 + listResources/verbsForResource）
- `dispatch.ts`：传输无关分发器（parseCmd → 三层 help 拦截 → 守卫 deny → `--help` → 审批 hold → 执行 → i18n 错误 + usage）
- `crud.ts`：声明式资源 CRUD 生成器（列白名单/scopeField 按组过滤/agentVisible）
- `resources.ts`：资源命令注册（groups/wirings/users/roles/members/sessions/tasks/approvals/dropped/kb/destinations/status + eval）
- `commands/`：按资源分文件的自定义动词（groups/channels/sessions/tasks/chat/config）
- `client.ts`：oc 命令行客户端（argv 或 --stdin-json → 控制 socket → 发帧 → 单次打印）
- `parse-argv.ts`：客户端 argv 解析（剥离 --json/--stdin-json，其余原样空格拼成 wire cmd）
- `socket-server.ts`：CLI 控制 socket 服务端（Windows 命名管道 + 行缓冲帧 + 调用者身份注入）
- `format.ts`：服务端渲染（renderTable 按显示宽度对齐 + ISO 时间戳本地化 + formatHuman）
- `help-render.ts`：三层帮助渲染（资源 / 动词 / 字段）+ usage + unknown-command 提示
- `transport-errors.ts`：连不上宿主时的可行动提示（ENOENT/ECONNREFUSED/EPERM/EACCES → 启动命令）
- `delivery-action.ts`：CLI 通道的投递动作注册（ask_question / card 等消息类型的终端渲染）
- `eval-resource.ts`：eval 命令（eval run/report）

## 承重约定
- **服务端渲染**：终端输出由宿主生成 `human` 字段，客户端只是打印机；`--json` 才拿原始结构（且不含 `human`）。
- **wire cmd 用空格分隔**（`"groups list"`），不是 nanoclaw 的 dash 连接（`"groups-list"`）——
  `dispatch.parseCmd` 按 `/\s+/` 切分，改成 dash 连接会让注册表永远匹配不上。
- **`--help` 拦截位置**：必须在 agent deny 之后、审批 hold 之前。否则 group 面 agent 能借
  `--help` 探测越权资源，或问一句帮助就生成一张审批卡。

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 help 命令 + kb add/sync
- 2026-10-05 修 `oc help` 死代码（parseCmd 曾要求 ≥2 token，help 分支永不可达）；补三层帮助
- 2026-10-06 P0-4 client 单次打印 + 坏帧兜底；P1-5 --json 去 human、--stdin-json 真实现、
  argv 解析收敛到 parse-argv.ts；P2-1 删除从未被 import 的 `guard.ts`（守卫逻辑仍在 dispatch.ts 内联）；
  P2-3 表格/帮助改按显示宽度对齐（CJK）
- 2026-10-06 P0-1：更正 delivery-action.ts 描述（它是 ask_question/card 的终端渲染，
  不是容器侧 cli_request）；容器侧 mailbox CLI 明确为未实现（见 container/agent-runner/src/cli/README.md）
