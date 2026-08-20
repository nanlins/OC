# db

> 用途：容器侧会话 DB 访问层（inbound 只读/outbound 写/心跳/状态）

## 内容清单
- `connection.ts`：DB 连接管理（journal_mode=DELETE、open-write-close、heartbeat 文件 touch）
- `messages-in.ts`：入站消息读取（奇偶 seq 门控、on_wake 仅首轮、pending+processing 过滤）
- `messages-out.ts`：出站消息写入（奇数 seq 车道、writeMessageOut 返回 seq）
- `schema.ts`：会话双 DB 表结构
- `session-state.ts`：会话状态持久化（continuation/历史轮换/currentInReplyTo）

## 修改记录
- 2026-08-12 创建