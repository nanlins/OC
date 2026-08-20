# scheduling

> 用途：定时任务模块（任务=消息行 + series_id + script-gate）

## 内容清单
- `scheduling.ts`：Cron 解析 + 同期预测 + 退避 + 暂停/恢复 + 连败指数退避

## 修改记录
- 2026-08-12 创建