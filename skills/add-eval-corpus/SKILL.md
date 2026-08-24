---
name: add-eval-corpus
description: 为评估体系追加一个领域的评估语料（eval corpus）。当用户要求"追加评估语料"或"测试某个领域"时使用。
---

# Add Eval Corpus

为 OC 评估体系追加一个新的领域语料种子（seed JSON）。以下只做确定性步骤，创意性工作如语料内容撰写、弹性拒答场景由 agent 完成。

## 步骤

1. 确认领域名（小写连字符）：如用户未给定，询问
```nc:prompt var=domain
领域名（小写连字符，如 refund）
```

2. 编写 10 个问答 + 3 个拒答场景（agent 完成，JSON 形态参照 src/eval/corpus/seed-zh.json）

3. 将语料写入 data/eval/corpus/<domain>.json
```nc:copy from=payload/seed-template.json to=data/eval/corpus/{{domain}}.json```

4. 追加索引记录到评估语料清单
```nc:append file=data/eval/corpus-index.txt line={{domain}}
```

5. 运行 `oc eval run --kb kb` 验证新语料可被检索和判分；向用户展示 hitRate 与失败 case

## 约束
- 语料不得含密钥或个人信息
- 拒答场景必须标注 outOfDomain=true

## 修改记录
- 2026-08-13 创建（阶段 13）
- 2026-08-24 修复中文乱码