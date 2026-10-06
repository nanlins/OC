# mailbox

> 用途：容器侧邮箱抽象层——"读批 → 置 processing → 写结果"的会话生命周期与 MCP 工具的统一执行入口（P0-1，补齐相对 nanoclaw 的内核缺口）

## 内容清单
- `types.ts`：MailboxMessage / OutboundDraft / MailboxBatch / MailboxSession / MailboxAction
- `compose.ts`：批次组装（composeBatch）+ 邮箱上下文（readMailboxContext）
- `model.generated.ts`：与宿主 schema 对齐的列清单。**注意**：nanoclaw 里该文件由宿主模型同步生成；
  OC 尚未实现生成器，此为手工同步版本——宿主 `src/db/session-db.ts` 的 schema 改动必须同步这里
- `sqlite/connection.ts`：SQLite 连接面（复用 db/connection.ts，不重复实现）
- `sqlite/operations.ts`：会话操作实现（readPending/mark*/writeOutbound/state KV）
- `sqlite/index.ts`：SqliteMailbox 工厂
- `index.ts`：门面——`getAgentMailbox()` / `withMailboxSession()` / `readMailboxContext()` / `mailbox.run(action)`
- `mailbox.test.ts`：会话生命周期 / run 包装 / 读批+置 processing / 状态 KV / 批次组装

## 承重约定
- **会话边界 ≠ SQLite 长事务**：双库是 DELETE journal，写事务排他锁文件。跨 LLM 调用持锁会饿死
  宿主的投递轮询。因此 withMailboxSession 只管理连接生命周期（open → 回调 → close），
  原子性由单语句保证（宿主侧的 armTaskAtomically 同理）。
- MCP 工具经 `executeToolCall → mailbox.run` 统一调度，工具拿到 `ctx.mailbox` 会话面，
  不再各自直接 import db 层。

## 修改记录
- 2026-10-06 创建（P0-1：mailbox 抽象层；poll-loop 与 tool-loop 已接入）
