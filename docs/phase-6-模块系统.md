# 阶段 6 记录：模块系统

> 用途：记录阶段 6（typing/permissions/approvals/scheduling/a2a/interactive/self-mod + memory-kb/observability/quota 扩展）的决策、问题、对标与扩展。

## 一、重要决策
1. **模块 barrel 导入顺序即契约**：approvals 先于 self-mod（requestHold 依赖）；ESM 直接 import 双保险。
2. **guard 审计 sink 注入**：delivery-guard 保持领域无关，observability 经 setAuditSink 落 guard_audit 表（allow/hold/deny 全留痕）。
3. **审批安全三件套**：grant 活行复核器（查库验 pending，伪造内存对象不过）+ 先回放后删行（恰好一次）+ 动作名三处同名闭合（投递注册名=审批 action=grantActionName）。
4. **interactive 精确路由**：question_routes 表（questionId→session）+ 应答拦截器内做发送者门控 + userId 落库 + wake；容器侧专用 kind='question_response' 精确等值匹配（禁 JSON LIKE）。
5. **scheduling 预测式限频**：未来 24h cron 推演 >4 次/天拒绝（基线语义）；连败≥8 写 paused 可恢复行并纳入 countLiveTasks（防 GC 永久销毁）。
6. **a2a 授权复核**：routeAgentMessage 查源会话 destinations 投影（路由表即 ACL），未授权抛错；writeDestinations 事务包裹。
7. **typing 生命周期**：onDeliveryComplete 钩子，投递成功即停刷新。
8. **RAG 扩展形态**：BM25-lite + 递归分块（超大段复切）+ 阈值拒答 + source/chunkSeq 溯源；评估集 21+3+1 留档（含失败 case 分析）。

## 二、所遇问题与修复方案
1. **P0（se）回放名断裂**：审批 action 与投递注册名不一致 → 批准后静默不执行且谎报日志 → 三处同名 + reenter 动作缺失改抛错 + e2e 回归测试（self-mod 经 resolveApproval 真实 apply）。
2. **P0（ai）自动暂停=永久丢失**：trailing≥8 仅 continue → 同 tick GC 销毁系列 → 写 paused 行 + countLiveTasks 含 paused + armed 检查含 paused。
3. **P1 限频死代码** → 预测式 cron 推演（countFiresIn24h）。
4. **P1 writeDestinations 非事务** → inbound.transaction 包裹。
5. **P1 a2a 无授权** → destinations ACL 复核 + 未授权回归测试。
6. **P1 typing 永不停止** → onDeliveryComplete 停刷新。
7. **P1 grant 伪造对象可通过** → setGrantLiveValidator 查库。
8. **P1 审批先删后放** → 先放后删，失败保留可重试。
9. **P1 拦截器注入面** → 门控+questionId UUID 校验+userId+精确路由表。
10. **P1 容器 LIKE 匹配** → 专用 kind + JS 精确匹配 + markCompleted。
11. **P1 self-mod precheck 弱** → 16KB payload/args≤32/禁版本后缀与路径形包名。
12. **P1 memory-kb 超大段不复切** → 分隔符降级递归 + hardSplit 兜底；KbHit 增 source/chunkSeq。
13. 工程：001 已有 pending_questions 表与模块迁移撞名 → 模块表改名 question_routes。

## 三、对标 claw 开源源码完成度
- 已复刻：typing 刷新/停止语义；permissions 三态门控（strict/public 完整）；approvals 偏好链+恰好一次；scheduling 任务=消息行+cron 组时区+预测限频+paused；a2a 路由+ACL+投影事务；self-mod HOLD+precheck 硬化+apply+restart；interactive pending 路由表形态。
- 简化（记录在案）：request_approval 策略仍等价 strict（无扣消息/回放链）；self-mod apply 无镜像 rebuild（容器不消费 packages/mcpServers 字段，阶段 10 或后续闭环）；reason-capture 简化；无 run-log；退避公式 2*2^n 与基线差一档。
- 缺失：script 门控（容器 task-script 已备，宿主侧未串联）；pending_sender_approvals 完整流程。

## 四、扩展度
- memory-kb（RAG）/observability（guard_audit）/quota（SQLite 限流）为基线无对应物的自主扩展，落地知识文档 03/04/05。
- RAG 评估集 21 命中 + 3 拒答 + 1 失败 case 留档（无分词限制，pgvector 接入回归）。
- grant 活行复核器强于基线内存对象校验路径的显式化。
- 回归测试锚定：a2a 未授权、预测限频、paused 可恢复、self-mod e2e 回放、interactive 往返。

## 修改记录
- 2026-08-12 创建。
