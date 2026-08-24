# security

> 用途：安全模块——Prompt注入防御、内容过滤、审计日志、API Key管理

## 内容清单
- `input-guard.ts`：Prompt 注入防御框架（输入分类 + 注入检测 + 分隔符隔离）
- `content-filter.ts`：内容安全过滤（PII 检测 + 敏感词过滤 + 输出脱敏）
- `audit.ts`：结构化审计日志（append-only JSONL + 可导出 CSV + 自动轮转）
- `api-key-manager.ts`：API Key 管理（租户隔离 + 轮换 + 用量监控）

## 修改记录
- 2026-08-24 创建（阶段 11 五、文档之外可扩展方向）