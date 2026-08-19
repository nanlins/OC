# setup

> 用途：安装向导——步骤分发（--step）、三级输出契约 L2 状态块、内置步骤。

## 内容清单
- `status.ts`：emitStatus 状态块契约
- `runner.ts`：parseStatusStream + registerStep/runStep（重复注册抛错）
- `steps.ts`：environment/timezone/set-env/verify（registerBuiltinSteps 幂等）
- `index.ts`：--step/--list 分发入口（OPENCLAW_SETUP=1 区分主机入口）

## 修改记录
- 2026-08-13 创建（阶段 8）。
