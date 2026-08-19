# 阶段 1 记录：数据库层

> 用途：记录阶段 1（中央 DB + 迁移运行器 + CRUD + 会话双 DB）的决策、问题、对标与扩展。

## 一、重要决策
1. **迁移系统**：name 键控去重（version 仅顺序提示）+ `module:<owner>:<id>` 命名空间 + FK 安全协议（事务外切 pragma、事务内 foreign_key_check 新旧违规差分，既有孤儿只 warn 不 fail）——逐字复刻 nanoclaw `src/db/migrations/index.ts` 事故复盘。
2. **三库模型**：中央 v2.db（WAL）+ 每会话 inbound/outbound（DELETE）；schema.ts 仅作只读参考副本，建表全走迁移。
3. **hasTable 守卫**：模块私有表缺失时核心静默降级。
4. **覆盖率工具**延后接入（P2 跟踪）。

## 二、所遇问题与修复方案
1. `noUncheckedIndexedAccess` 严格索引批量类型错误 → `!`/`??` 修正。
2. 新增集成测试忘跑迁移导致"no such table" → beforeEach 统一 `runMigrations(initTestDb(), [migration001])`。
3. Windows 附件目录名含 `:`（msgId 命名空间化）非法 → saveInboundAttachments 目录名净化 `[^A-Za-z0-9_-]→_`。
4. 熔断器测试算术错误（diff=3,599,001 < 窗口）→ 修正测试 nowMs 基准。
5. se-inspector P1：`syncProcessingAcks` 无白名单/终态守卫（completed 可被残留 processing 回退、任意状态灌入）→ 白名单 + `NOT IN ('completed','failed')` 守卫。
6. se-inspector P1：`resetStuckProcessingRows` 孤儿 ack 跨库删除逻辑错误（outbound 内查 messages_in 不存在）→ 改为双库各自读取后差集删除。
7. se-inspector P2：processing_ack 无界增长 → `pruneSyncedProcessingAcks`。

## 三、对标 claw 开源源码完成度
- 已复刻：迁移运行器全套协议；中央 12 表 CRUD（agent-groups/messaging-groups/sessions/container-configs/users+roles+members）；session-db 双库 schema + 偶数 seq + delivered 簿记 + ack 同步。
- 简化：会话库惰性列迁移（新项目无存量，删除）；dropped_messages 表以 unregistered_senders 聚合表替代（审计模型变更，记录于 phase-2）。
- 缺失：chat_sdk_* 四表与 state-sqlite（决策不引入 Chat SDK 桥接，见 phase-2 决策）。

## 四、扩展度
- `users.link_key` 跨通道 linking（基线 schema 注释自认 "no linking yet"）。
- 单写者"成文例外"文档化制度（writeOutboundDirect 第一例外）。
- 回归测试锚定：multi-FK 差分、claims 源、先写为准等。

## 修改记录
- 2026-08-12 创建。
