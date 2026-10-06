# scripts

> 用途：运维与实测脚本——chat / send-once / set-group-model / set-group-provider / delete-wiring / setup / demo-setup

## 内容清单
- `setup.ts`：**`pnpm setup` 的唯一入口**（@clack 交互向导：供应商/密钥/模型 → 写 .env →
  建默认 Agent 组 + CLI 接线）。旧的 `src/setup/` 步骤式框架已删除（2026-10-06 R-5），
  不再存在第二套安装实现。
- `demo-setup.ts`：演示环境一键初始化（建 Demo 组 + CLI 接线，幂等）
- `chat.ts`：CLI 聊天对讲客户端（命名管道连接 + 逐行打印对话，非交互模式默认退出）
- `send-once.ts`：单次消息工具（发送即退，用于触发 messaging_group 自动创建）
- `set-group-model.ts`：确保 container_configs 行并设置 provider + model
- `set-group-provider.ts`：显式改写 container_configs.provider（运维纠错）
- `delete-wiring.ts`：按 id 删除接线（messaging_group_agents）

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 chat/send-once/set-group-model/delete-wiring 脚本
- 2026-10-06 R-5：删除 src/setup/（步骤式向导）与根 setup/ 目录，setup.ts 成为唯一安装入口
