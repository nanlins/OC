# interactive-scheduling-web — 交互/任务/网络工具

用途：ask_user_question / send_card / schedule_task / list_tasks / cancel_task / web_fetch / web_search。

关键约束：
- `ask_user_question`：问题经渠道卡片呈现，等用户回答；300s 超时，questionId 精确等值匹配，消费后删除。
- `schedule_task`：宿主侧预测式限频（24h 内 >4 次触发拒绝）；cron 与 process_after 二选一；可携带 pre-task 脚本信封（脚本失败按 script-skip）。
- `web_fetch` 结果标 `untrusted: true`，模型必须告知用户内容未经核实；SSRF 防护依赖容器网络隔离。
- `cancel_task` 只作用于本组自己的任务（scope 隔离在宿主执行）。
