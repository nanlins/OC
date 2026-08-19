# 阶段 5 记录：投递与通道

> 用途：记录阶段 5（delivery 双轮询/delivery-guard/CLI 通道/instance 戳印接线）的决策、问题、对标与扩展。

## 一、重要决策
1. **投递桥直连 channel-registry exact 键**：省去基线 ChannelDeliveryAdapter 间接层与 destinations ACL（单通道 trunk 合理，ACL 属阶段 6）。
2. **系统动作以 content JSON `type` 分派**（与容器契约一致）；getDeliveryAction 返回 runGuarded 包裹后的 callable，"不存在绕过 guard 的路"。
3. **hold 无 requestHold 即抛错**走 retry/failed，绝不静默误标 delivered（基线 requestHold 必填的强化版）。
4. **CLI 通道**：Unix socket chmod 0600（权限即身份）/ win32 named pipe；JSON 行协议 + 纯文本兜底；多客户端广播（单聊天槽位的刻意简化，记录在案）。
5. **operation 列透传**：messages_out.operation 进入投递桥与 CLI 输出，edit/reaction 语义可判别。

## 二、所遇问题与修复方案
1. **P0 delivery 未接入 main**（副作用 barrel 漏 import，投递轮询生产空转）→ index.ts `import "./delivery.js"`。
2. **P1 reenter 丢 grant**（批准回放永远再 HOLD）→ reenter/getDeliveryAction 签名携带 PendingApproval 透传 grant；补"非 live grant 不执行"回归测试。
3. **P1 getDeliveryAction 暴露裸 handler** → 返回包裹后 callable。
4. **P1 open 失败毒化 inflight 去重表** → open 移入 try + finally 兜底清理 + 空值安全 close。
5. **P1 hold 静默丢弃** → 抛错走 failed（见决策 3）。
6. **P1 operation 丢失** → MessageOut/OutboundMessage 增补并透传。
7. **P1 错误类型** → deliverViaAdapter 改用 requireDeliveryAdapter（MissingChannelAdapterError）。
8. 工程：CLI teardown win32 管道释放等待（防旧 server 竞态）；测试 connection 注册竞态加等待。
9. P2 记录：platformMessageId 已记录；getChannelAdapter 回退版零调用留案；setInterval tick 重叠由 inflight 兜底。

## 三、对标 claw 开源源码完成度
- 已复刻：双轮询（active 1s/sweep 60s）+ inflight 去重；delivered 簿记先写为准；重试≤3→failed 且重启清零；guard-wrapped 拒绝 unguarded 重注册；runGuarded 三段管线；instance 戳印接缝；CLI socket 通道形态。
- 简化：ask_question 选项卡宿主渲染延后阶段 6（interactive 模块），当前结构化 JSON 直投 CLI；messaging-group ACL/destinations 查询延后。
- 缺失：stopDeliveryPolls 在途 drain 等待（P2 留案）。

## 四、扩展度
- hold 无落地即 failed（强于基线静默）。
- precheck 失败触发 onDeny（基线静默 return）。
- win32 named pipe 支持 + teardown 释放探测（基线仅 unix）。
- 回归测试锚定：缺适配器 failed/deny 通知/grant live 校验/operation 透传/inflight 幂等。

## 修改记录
- 2026-08-12 创建。
