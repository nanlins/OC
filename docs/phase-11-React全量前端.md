# 阶段 11 记录：React 全量前端

> 用途：记录阶段 11（Vite+React 控制台：组件/路由/状态/SSE/审批与 wiring 管理/组件测试）的决策、问题、对标与扩展。

## 一、重要决策
1. **零路由/零状态外部依赖**：hash 路由 + useSyncExternalStore 轻量 store，控制依赖面（供应链纪律）。
2. **workspace 化**：pnpm-workspace 收纳 web/frontend；vite dev 代理 /api 与 /events 到主机 8080。
3. **i18n 基础内置**：zh/en 字典 + useT + localStorage 持久化（阶段 14 全量扩展基座）。
4. **SSE 事件驱动刷新**：事件到达即增量刷新 + 10s 轮询兜底。
5. **测试纪律**：组件测试全 mock fetch（vi.stubGlobal），不连主机。

## 二、所遇问题与修复方案
1. **vite 5 与 vitest 4 不兼容**（缺 ./module-runner 子路径）→ 升 vite ^7（agent 环境修复，记录在案）。
2. **pnpm 11 allowBuilds 占位**→ esbuild/better-sqlite3 显式 true（用户此前已批准二者构建）。
3. P2 记录：SSE 无心跳帧重连退避（EventSource 自动重连默认）；表格无虚拟滚动（数据量小，记录在案）。

## 三、对标 claw 开源源码完成度
- 基线无 Web 控制台（clidash 技能为只读仪表盘）——本阶段为自主扩展，管理面语义与 ncl 资源同源。
- 扩展：审批 Web 闭环、wiring 创建表单、SSE 直播、i18n 基座。

## 四、扩展度
- 6 页面 + 5 组件测试文件 11 用例；store/api/i18n 三层分离。
- 累计前端 ≈1,000 行（含测试）。

## 修改记录
- 2026-08-13 创建。
