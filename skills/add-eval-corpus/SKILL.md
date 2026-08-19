---
name: add-eval-corpus
description: 为评估体系追加领域语料（eval corpus）。当用户要求"加评估语料/扩充测试集/新增领域问答"时使用。
---

# Add Eval Corpus

为 OpenClaw 评估体系追加一个领域的语料种子（seed JSON）。引擎只执行确定性步骤；
引擎不会的（如语料内容撰写）弹回给 agent 完成。

## 步骤

1. 确认领域名（小写连字符）与期望文档标题；若用户未给，先问。

```nc:prompt var=domain text=领域名（小写连字符，如 refund）
```

2. 撰写 ≥10 条问答 + ≥2 条域外拒答（agent 完成，JSON 形态同 src/eval/corpus/seed-zh.json）。
3. 将语料写入 data/eval/corpus/<domain>.json：

```nc:copy from=payload/seed-template.json to=data/eval/corpus/{{domain}}.json
```

4. 追加登记到评估清单：

```nc:append file=data/eval/corpus-index.txt line={{domain}}
```

5. 运行 `oc eval run --kb kb` 验证新语料可被检索与判分；向用户展示 hitRate 与失败 case。

## 约束

- 语料不得含秘密或个人信息。
- 域外用例必须标记 outOfDomain=true。

## 修改记录
- 2026-08-13 创建（阶段 13）
