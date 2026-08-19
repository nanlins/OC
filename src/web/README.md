# web

> 用途：Web 管理控制台——REST 只读投影 + 动作（经既有守卫）+ SSE 事件直播 + 静态前端。

## 内容清单
- `api.ts`：/api/* 投影与动作（approvals resolve / wirings create 经 dispatch）；可选 WEB_TOKEN Bearer
- `events.ts`：事件总线 + delivery 钩子接入
- `server.ts`：http server（REST + /events SSE + static/）；host-lifecycle 注册
- `static/`：index.html / app.js / style.css（无构建步骤的单页仪表盘）

## 修改记录
- 2026-08-13 创建（阶段 9）。
