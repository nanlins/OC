# guard

> 用途：特权动作决策接缝：allow/hold/deny + 品牌化动作值 + grant 批准回放 + fail-closed

## 内容清单
- `types.ts`：GuardActor/GuardInput/GuardDecision/ALLOW/DENY/HOLD/unguarded 品牌/GuardDenyError（"遗漏不可表示"）
- `guard-actions.ts`：defineGuardedAction（WeakSet 品牌 + 重名抛错）/isGuardedAction/listGuardedActions
- `guard.ts`：唯一决策函数；grant 只满足 hold 永不松动 deny；结构检查每次回放重跑
- `index.ts`：barrel

## 修改记录
- 2026-08-12 创建（阶段 0 骨架）
- 2026-08-12 阶段 3 落地全套
