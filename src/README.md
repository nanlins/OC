# src

> 用途：主机源码（TypeScript）：单进程编排器，路由/投递/会话/容器/巡检/CLI 入口

## 内容清单
- 入口与基础设施：`index.ts`（启动编排）、`config.ts`、`env.ts`、`log.ts`、`types.ts`、`timezone.ts`、`install-slug.ts`、`platform-id.ts`
- 生命周期与韧性：`host-lifecycle.ts`、`circuit-breaker.ts`
- 路由管线：`router.ts`（钩子接缝）、`command-gate.ts`
- 会话：`session-manager.ts` + 附件/收件箱安全三件套（`attachment-naming/safety`、`inbox-safety`）
- `db/`：数据库层；`channels/`：通道适配器层；`providers/`/`modules/`/`cli/`/`guard/`/`templates/`/`web/`：后续阶段填充

## 修改记录
- 2026-08-12 创建（阶段 0 骨架）
- 2026-08-12 阶段 2 落地：config/env/timezone/slug/circuit-breaker/host-lifecycle/session-manager/安全三件套/command-gate/router/index 编排
