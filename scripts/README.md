# scripts

> 用途：运维与技能引擎脚本——chat、send-once、set-group-model、delete-wiring、kb 管理等

## 内容清单
- `chat.ts`：CLI 通道对话客户端（命名管道连接 → 发消息 → 打印回复，静默退出）
- `send-once.ts`：单次发送工具（发一条消息即退出，用于触发 messaging_group 自动创建）
- `set-group-model.ts`：确保 container_configs 行并设置 provider + model
- `set-group-provider.ts`：显式改写 container_configs.provider（运维纠错）
- `delete-wiring.ts`：按 id 删除接线（messaging_group_agents）

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 chat/send-once/set-group-model/delete-wiring 脚本