# 阶段 10 记录：通道适配器全量

> 用途：记录阶段 10（8 平台通道适配器 + 通用 webhook）的决策、问题、对标与扩展。

## 一、重要决策
1. **依赖注入可测性**：所有适配器 fetchImpl/wsFactory/socketFactory 注入，测试纯本地 mock，不连外网（测试纪律）。
2. **凭据经 readEnvFile 白名单**：缺失即 factory null（通道跳过），不写 process.env。
3. **defaults 声明两级模型**：dm/group 上下文 + mentions 能力位；线程能力按平台真实声明（telegram/discord/slack=true，其余 false）。
4. **退避纪律**：discord 重连指数退避上限 1h（防封禁，基线同语义）；telegram 空结果短憩防紧循环。
5. **纯函数解析导出**：feishu/dingtalk/wecom/webhook 导出 parseXEvent 纯函数，供 webhook 接线与测试共用。

## 二、所遇问题与修复方案
1. **telegram 紧循环 OOM**：mock fetch 即时返回致轮询紧循环打爆堆 → 空结果 500ms 短憩 + result 单次求值 + 回归测试有状态 mock。
2. **discord 测试索引错位**：构造器 @me 预取占用 calls[0] → 改 find 断言。
3. **webhook-generic 接线缝**：web/server 无 registerWebhookHandler → 导出 handleWebhookPayload + ingestWebhookPayload 接线缝（阶段 11/12 接线）。
4. 基线 lint 遗留 discord 未用 log import → 删除并在修改记录留痕。

## 三、对标 claw 开源源码完成度
- 已复刻：通道注册 barrel 形态（新增=一行 import）；ChannelDefaults 声明；长轮询/gateway/签名出站三形态；退避纪律。
- 扩展：基线 channels 分支 17 通道中选取 8 通道 + 中国平台三件套（飞书/钉钉/企微）为自主扩展。
- 缺失：socket-mode 之外的 slack events 签名校验细化、wechat 通道（评估后延后）。

## 四、扩展度
- 中国平台通道（飞书/钉钉/企微）+ email 最小 IMAP/SMTP 客户端（无新依赖，node:net/tls 自实现）。
- webhook-generic 双形态解析（通用 JSON + GitHub push）。
- 通道测试 61 用例（telegram 4 + discord 4 + slack 8 + feishu 8 + dingtalk 8 + wecom 6 + email 4 + webhook 7）。

## 修改记录
- 2026-08-13 创建。
