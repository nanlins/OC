# setup

> 用途：安装向导——步骤分发（--step）、三级输出契约 L2 状态块、内置步骤

## 内容清单
- `index.ts`：安装向导入口（OPENCLAW_SETUP=1 触发 + --list 步骤列表）
- `runner.ts`：安装执行器（按步骤顺序执行 + 状态机）
- `status.ts`：安装状态输出（emoji 前缀 + 步骤序列）
- `steps.ts`：内置步骤（environment/timezone/set-env/verify）

## 修改记录
- 2026-08-12 创建