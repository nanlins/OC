# db

> 用途：数据库层：中央 DB 连接、schema 参考、各表 CRUD、会话双 DB 操作

## 内容清单
- `connection.ts`：中央 DB 单例连接（WAL + foreign_keys=ON）+ hasTable 模块守卫
- `schema.ts`：schema 只读参考副本（运行时建表走 migrations/，勿执行本文件）
- `migrations/`：迁移运行器（name 键控 + FK 安全协议）+ 001-initial 中央 schema
- `agent-groups.ts` / `messaging-groups.ts` / `sessions.ts` / `container-configs.ts` / `users.ts`：各表 CRUD
- `session-db.ts`：会话双 DB（inbound/outbound）全部 SQL：偶数 seq、到期门控、ack 同步、投递簿记、withInboundDb
- `index.ts`：barrel 再导出

## 修改记录
- 2026-08-12 创建（阶段 0 骨架）
- 2026-08-12 阶段 1 落地全部文件；se-inspector 修复 P1-1~P1-4、P2-1~P2-8 后补内容清单
