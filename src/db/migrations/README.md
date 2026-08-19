# migrations

> 用途：迁移脚本：name 键控迁移运行器 + 内建/模块迁移（FK 安全协议）

## 内容清单
- `index.ts`：迁移运行器。去重键=name；模块迁移命名空间 `module:<owner>:<id>`；
  disableForeignKeys 迁移走"事务外切 pragma + 事务内 foreign_key_check 新旧违规差分"协议（parent+fkid 身份键）
- `001-initial.ts`：中央 schema 基线（12 张实体表 + schema_version）

## 修改记录
- 2026-08-12 创建（阶段 0 骨架）
- 2026-08-12 阶段 1 落地；P1-4 修复身份键；P2-7 既有违规 warn
