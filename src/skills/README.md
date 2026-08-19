# skills

> 用途：技能引擎——nc: 指令解析/lint、无 UI 策略推导、确定性 apply（journal 幂等+可回滚）。

## 内容清单
- `directives.ts`：八种指令解析 + validate（未知/退役/未闭合/变量先定义后使用）；k=v 与 k:v 双形态
- `policy.ts`：gatePolicy 自然屏障 + extractOfferUrl
- `apply.ts`：applySkill（safeJoin 收口/逐指令 bounce/secret 排除/尾换行防护）+ removeSkill 倒放

## 修改记录
- 2026-08-13 创建（阶段 8）；同日补 se-inspector P0/P1 修复（safeJoin/bounce/secret/旧值回滚/未闭合 fence）。
