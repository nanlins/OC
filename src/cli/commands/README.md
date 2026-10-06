# commands

> 用途：CLI 命令注册与帮助系统

## 内容清单
- `groups.ts`：groups restart 命令（groups create 在 resources 桶 `resources/groups.ts`）
- `channels.ts`：channels add 命令
- `sessions.ts`：sessions clear 命令
- `tasks.ts`：**预留空桩**（tasks list/cancel 已注册在 resources 桶 `resources/tasks.ts`，本文件刻意无命令）
- `chat.ts`：chat send 命令
- `config.ts`：config show/set 命令
- `index.ts`：命令 barrel（registerAllCommands，幂等）

> 覆盖率说明（2026-10-06）：全部命令均已接线（registerAllCommands ← registerAllResources ← socket-server/web），
> handler 最小单测见 `tests/unit/cli-commands.test.ts`；目录覆盖 40% → 100%。
> tasks.ts 恒 0%（空桩无语句，tasks 命令在 resources 桶已由测试断言可查）。

## 修改记录
- 2026-08-12 创建
- 2026-08-24 补齐未完成清单：6 个命令文件 + barrel
- 2026-10-06 修正 groups/tasks 描述；补 handler 最小单测（coverage 40% → 100%）