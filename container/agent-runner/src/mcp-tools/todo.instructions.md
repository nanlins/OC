# todo — 子任务清单

用途：todo_write——持久化当前任务的子任务清单（跨消息可见）。

关键约束：
- 清单存 session_state 的 `todos` 键（JSON），系统提示每轮重新渲染，故更新后下一轮即生效。
- 状态三值：pending / in_progress / completed；同一时刻至多一个 in_progress。
- 任务结束时清理清单（空数组），不留陈旧状态污染后续会话。
