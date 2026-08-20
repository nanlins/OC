# integration

> 用途：集成测试（真实 SQLite + temp dir + 真实 socket 回环）

## 内容清单
- `web.test.ts`：Web 控制台测试（REST 投影/审批/SSE/静态/鉴权/CSRF/413/traces/build:web）
- `cli.test.ts` / `cli-channel.test.ts`：CLI 管理命令与通道适配器测试
- `router.test.ts` / `delivery.test.ts` / `host-sweep.test.ts`：路由/投递/巡检测试
- `container-runner.test.ts`：容器运行器测试（注入 spawner/env-file 密钥）
- `session-manager.test.ts` / `session-db.test.ts` / `db-v2.test.ts`：会话/DB 测试
- `modules.test.ts`： 模块系统集成测试
- `telegram.test.ts` / `discord.test.ts` / `slack.test.ts` / `email.test.ts`：渠道适配器测试
- `feishu.test.ts` / `dingtalk.test.ts` / `wecom.test.ts` / `webhook-generic.test.ts`：国内平台测试
- `eval.test.ts`：评估体系集成测试

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补鉴权/CSRF/413/traces/build:web/email TLS 回归
