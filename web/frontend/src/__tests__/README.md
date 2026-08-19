# src/__tests__

> 用途：控制台前端组件测试（vitest + @testing-library/react + user-event，jsdom 环境）。

## 内容清单

- `dashboard.test.tsx` —— mock fetch 投影，断言 Dashboard 计数卡渲染。
- `approvals.test.tsx` —— 待审批渲染与批准/拒绝 POST `/api/approvals/resolve` 断言。
- `sessions.test.tsx` —— 展开消息按钮调 `sessionMessages` 并渲染截断内容。
- `wirings.test.tsx` —— 双选择提交 POST `/api/wirings` body 断言。
- `i18n.test.ts` —— `setLocale` 后 `useT` 语言切换断言。

约定：测试前 `vi.stubGlobal('fetch', ...)`；`afterEach` 中 `cleanup + actions.stop() + vi.unstubAllGlobals()`。

## 修改记录

- 2026-08-13 创建（阶段 11）。
