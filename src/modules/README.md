# modules

> 用途：功能模块系统——注册表 + 钩子插拔，核心零领域知识

## 内容清单
- `index.ts`：模块 barrel（副作用注册全部模块钩子）
- `permissions.ts`：权限模块（访问门控 + sender_scope 门 + 未知发送者策略）
- `approvals.ts`：人工审批流（pickApprover 偏好链 + requestApproval 建行投卡 + resolveApproval 回放恰好一次）
- `scheduling.ts`：调度模块（Cron 解析 + 同期预测 + 退避 + 暂停/恢复 + 连败指数退避）
- `agent-to-agent.ts`：A2A 模块（destinations 投影 + 跨会话路由 + 授权复核）
- `interactive.ts`：交互模块（ask_user_question 应答路由 + 精确等值匹配 + 发送者门控）
- `self-mod.ts`：自我修改模块（install_packages/add_mcp_server 恒 HOLD 审批 + precheck 硬化）
- `memory-kb.ts`：知识库（RAG）模块（分块 + BM25-lite 检索 + 可注入 embedding 向量检索 + 宿主/容器 KB 同步）
- `mount-security.ts`：挂载安全模块（白名单校验 + realpath 容纳 + RW 双条件降级）
- `observability.ts`：可观测模块（guard 审计 + 用量记账 + 注解）
- `quota.ts`：配额模块（recordUsage/checkQuota）
- `typing.ts`：打字指示模块（setTypingNotifier 钩子注册）
- `notifications.ts`：通知系统（多通道通知 + notifications 表）。**未接线**：全仓无调用方，启用须接入审批/任务完成路径并补投递消费者
- `rich-media.ts`：富媒体渲染（Telegram/Discord/Slack/Web/CLI 卡片与按钮）。**未接线**：全仓无调用方，启用须接入消息出口
- `user-dm.ts`：冷 DM 解析（ensureUserDm + user_dms 缓存）。**未接线**：模块与 `db/user-dms.ts` 均无调用方，启用须接入审批/通知的主动 DM 出口

> 接线状态标注约定（2026-10-06 覆盖率核查）：未接线模块如实标注为未接线，不补表面测试伪装完成。

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：memory-kb 补 embedding 向量检索 + exportKbToDir
- 2026-10-06 覆盖率核查：确认 notifications/rich-media/user-dm 未接线（无调用方），如实标注