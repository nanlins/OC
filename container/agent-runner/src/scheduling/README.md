# scheduling

> 用途：容器侧任务相关实现——pre-task 脚本门控（P0-3）

## 内容清单
- `task-script.ts`：`parseTaskEnvelope`（与宿主 task-content.ts 同语义，手工同步）+
  `runTaskScriptGate`（脚本执行、超时 SIGTERM/SIGKILL 进程组、输出上限 1MB、
  JSON 结果解析；错误/超时/无输出/wakeAgent=false → script-skip）
- `task-script.test.ts`：门控全分支测试

注：历史 README 曾声称本目录存在 `script-gate.ts`——该文件从未存在（幻影引用）。
真实实现文件名为 `task-script.ts`（对齐 nanoclaw 形态）。

## 修改记录
- 2026-08-12 创建（当时引用了不存在的 script-gate.ts）
- 2026-10-06 P0-3：实现 task-script.ts，修正幻影引用
