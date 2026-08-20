# unit

> 用途：单元测试（快速、无 IO、纯函数）

## 内容清单
- `i18n.test.ts` / `i18n-eval.test.ts`：i18n 运行时与评估交集测试
- `trace-safety.test.ts` / `rag-vector.test.ts`：路径穿越防御与向量检索测试
- `guard.test.ts` / `command-gate.test.ts`：guard 与命令闸门测试
- `migrations.test.ts` / `mount-security.test.ts`：迁移 FK 协议与挂载安全测试
- `circuit-breaker.test.ts` / `host-sweep-decide.test.ts`：熔断与巡检判定测试
- `skills-engine.test.ts` / `skills.test.ts`：技能引擎与指令测试
- `attachment-inbox-safety.test.ts` / `channels-env-lifecycle.test.ts`：附件安全与通道注册表测试
- `timezone.test.ts` / `setup.test.ts` / `smoke.test.ts`：时区/安装/冒烟测试

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补i18n-eval/trace-safety/rag-vector 测试
