# 阶段 9 记录：Web 管理控制台

> 用途：记录阶段 9（HTTP API + SSE + 静态前端）的决策、问题、对标与扩展。

## 一、重要决策
1. **无构建步骤单页前端**：index.html + app.js + style.css 直接静态服务，避免前端工具链膨胀；轮询投影 + SSE 直播双通道。
2. **动作面不绕过守卫**：/api/approvals/resolve 与 /api/wirings 均经 cli/dispatch（host caller），guard/cli_scope 语义复用。
3. **鉴权模型**：可选 WEB_TOKEN Bearer；未配置 = 127.0.0.1 本机信任（头注释声明）。
4. **只读投影白名单内联**：表名/列名内联白名单，防 SQL 注入面。
5. **SSE 事件总线**：delivery 完成经 onDeliveryComplete 钩子发布；订阅者隔离失败。

## 二、所遇问题与修复方案
1. **Web 动作面命令未注册**（resources 仅 CLI 入口注册）→ registerAllResources 幂等化 + web 启动时注册 + 回归测试。
2. **ESLint 9 flat config 不认 eslint-env** → eslint.config.js 对 static/*.js 加 browser globals。
3. P2 记录：SSE 无背压/心跳帧；静态路径 `..` 过滤为替换而非拒绝（MIME 白名单兜底）；审批按钮无 CSRF 防护（本机信任模型声明在案）。

## 三、对标 claw 开源源码完成度
- 基线无 Web 控制台（nanoclaw 以 ncl CLI + 技能 clidash 为管理面）——本阶段为自主扩展。
- 管理面语义对齐 ncl：groups/wirings/sessions/approvals/audit 投影与 ncl 资源同源（cli/resources 注册表共用）。

## 四、扩展度
- SSE 事件直播 + guard 审计可视化（observability 落地）。
- 审批 Web 闭环（approve/reject 按钮 → dispatch）。
- 回归测试锚定：投影/动作/SSE/静态。

## 五、复检修复（se-inspector CONDITIONAL PASS → 修复）
1. **P1 WEB_TOKEN .env 失效** → 加入 readEnvFile 白名单（秘密处理不变量保持：不写 process.env）。
2. **P1 /events 未鉴权** → SSE 分支复用 authorized()，401 拒绝。
3. **P1 关停挂起** → stopWebServer closeAllConnections + await close；回归测试（终止形态 done/terminated 双形态）。
4. P2：startWebServer 幂等；registerWebHooks 去重；timingSafeEqual；readBody 1MB 上限；静态 resolve+sep 容纳校验+isFile；cmd 拼接 safeToken 空白校验 + requestId；eslint 死条目清理。
5. 遗留记录：WEB_TOKEN 401 路径无回归锚点（模块级常量难注入，记录在案）。

## 修改记录
- 2026-08-13 创建；同日补复检修复节。
