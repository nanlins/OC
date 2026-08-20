# cli

> 用途：CLI 管理工具（oc）——socket 服务端、传输无关 dispatcher、泛型 CRUD 框架、cli_scope 执行

## 内容清单
- `frame.ts`：CLI 线上协议帧（RequestFrame/ResponseFrame 行分隔 JSON + CallerContext 带外身份）
- `registry.ts`：命令注册表（声明式 registerCommand + scope + agentVisible + listCommands）
- `dispatch.ts`：传输无关分发器（parseCmd → 守卫 → 审批 hold → 执行 + i18n 错误 + help 命令）
- `crud.ts`：声明式资源 CRUD 生成器（列白名单/scopeField 按组过滤/agentVisible）
- `resources.ts`：资源命令注册（groups/wirings/users/roles/members/sessions/tasks/approvals/dropped/kb + eval）
- `client.ts`：oc 命令行客户端（argv 拼 cmd → 控制 socket → 发帧 → 打印回复）
- `socket-server.ts`：CLI 控制 socket 服务端（Windows 命名管道 + 行缓冲帧 + 调用者身份注入）
- `eval-resource.ts`：eval 命令（eval run/report）

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 help 命令 + kb add/sync