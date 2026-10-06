# cli

> 用途：容器侧 mailbox CLI **未实现**。

## 状态说明

`container/agent-runner/src/cli/` 目前**没有任何真实实现**。此前的 `ncl.ts` 是假能力：

- 从未被任何模块 import；
- 从 `globalThis.__db_ctor` 取一个不存在的构造器；
- 写入 `messages_out` 时用了不存在的 `created_at` 列，且漏写必填列；
- 轮询的 `cli_response` 协议在主机侧（`src/`）根本不存在。

它已于 2026-10-06 删除。容器内的 agent 不需要一个假的终端入口；若未来要补容器侧
mailbox CLI，必须先落地主机端 `cli_request/cli_response` dispatch mailbox、修正
`messages_out`/`messages_in` 的 schema 与 SQL、注入真正的 DB 构造器，并配测试，
否则不要声称已完成。

## 修改记录

- 2026-08-12 创建（误描述 ncl.ts 为真实能力）
- 2026-10-06 P0-1：删除假能力 `ncl.ts`，改为如实说明"容器侧 mailbox CLI 未实现"
