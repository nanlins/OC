# scheduling

> 用途：定时任务模块（宿主侧）——创建/扇出/信封/运行日志（P0-3 按职责拆分）

## 内容清单
- `index.ts`：模块桶——schedule_task/cancel_task 投递动作 + 再导出（副作用注册）
- `create.ts`：createTaskInternal（校验/限频/写任务行三合一）+ MAX_DAILY_FIRES
- `recurrence.ts`：handleRecurrence（原子 re-arm + 连败退避 + ≥8 连败自动暂停）
- `task-content.ts`：任务内容信封 {prompt, script, originSessionId}，纯字符串旧任务向后兼容
- `run-log.ts`：appendRunLog / appendHostTaskNote → `groups/<folder>/tasks/<series>.md`

注：历史 README 曾声称本目录存在 `script-gate.ts`——该文件从未存在（幻影引用，R-3 记录在案）。
pre-task 脚本门控的真实实现在**容器侧** `container/agent-runner/src/scheduling/task-script.ts`，
本目录的 `task-content.ts` 负责信封的宿主侧编解码。

## 修改记录
- 2026-08-12 创建（当时描述与 nanoclaw 形态不符）
- 2026-10-06 R-3/P0-3：修正幻影引用；scheduling.ts 按职责拆入本目录
