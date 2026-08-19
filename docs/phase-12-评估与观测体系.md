# 阶段 12 记录：评估与观测体系

> 用途：记录阶段 12（Agent 轨迹、RAG 评估 harness、LLM-as-Judge、回归集、报表）的决策、问题、对标与扩展。

## 一、重要决策
1. **评估三层**：检索指标（hitRate/recall@K/MRR 纯函数）+ 判分（Judge 接口：MockJudge 确定性 / LlmJudge 注入 complete）+ 拒答统计。
2. **语料确定性生成**：种子语料 JSON（16 条手写，含域外拒答）× 前缀改写扩展（expandCorpus 纯函数，测试可断言稳定）。
3. **CJK bigram tokenize**：改写鲁棒（"请问如何申请退款" 可命中 "如何申请退款" 文档），latin 整词；judge 与检索共用同一 tokenize。
4. **轨迹 JSONL**：recordTrace 按 session 追加 data/traces/；router inbound + delivery 双接入；/api/traces/:id 查询。
5. **CLI eval 资源**：oc eval run/report（host scope），报告落 data/eval/。

## 二、所遇问题与修复方案
1. **MockJudge 中文整串匹配失效** → bigram tokenize 共用修复 + 回归测试。
2. **NodeNext JSON import** 需 `with { type: "json" }`。
3. **trace 跨运行累积**（temp DATA_DIR 持久）→ 测试 id 唯一化。
4. **Judge 接口去重**：types.ts 与 judge.ts 重复定义 → 收敛到 judge.ts。
5. P2 记录：LlmJudge 生产注入真实 provider 的接线延后；评估报表 Web 可视化延后。

## 三、对标 claw 开源源码完成度
- 基线无评估体系（nanoclaw 无 eval harness）——自主扩展，落地知识文档 03 §3.9 / 04 §4.11。
- 轨迹留痕对齐基线 upload-trace 语义的本地化形态。

## 四、扩展度
- eval CLI + API + 语料生成器 + 双 judge；trace 全链路接入。
- 累计评估测试 8 用例。

## 修改记录
- 2026-08-13 创建。
