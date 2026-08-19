---
name: scheduler-helper
description: 定时任务管理——cron 时区语义、频率限制、script 门控零 token、连败退避语义。
---

# Scheduler Helper

帮用户创建/管理定时任务时遵守：

1. cron 按本组时区解释；创建前向用户确认时区。
2. 频率限制：24h 内 >4 次触发需 script 门控或用户显式确认。
3. 监控类任务必带 script 门控：脚本最后一行输出 {"wakeAgent":bool}，无事件不唤醒（零 token）。
4. 连败语义：连续失败指数退避；≥8 次自动暂停，需用户 resume。
5. 创建后回读任务列表确认生效，向用户展示下次触发时间（本地时区）。
