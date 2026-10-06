# phase-11-文档之外扩展方向



> **⚠ 后续变更（2026-10-06，P2-1 死代码清理）**：本阶段产出的下列文件已从仓库删除，
> 因为它们自创建起**全仓零 import**——既不在 `src/index.ts` 启动链上，也没有任何测试引用，
> 属于"看起来已实现但从不执行"的代码：
> `src/security/input-guard.ts`、`src/security/content-filter.ts`、
> `src/security/api-key-manager.ts`、`src/security/audit.ts`、`src/providers/fallback.ts`、
> `src/providers/token-budget.ts`。
> 其中"审计用 JSONL 文件"这一决策已被实际实现取代：线上唯一审计源是中央库 `guard_audit` 表
> （`src/modules/observability.ts` 注册 audit sink，`src/delivery-guard.ts` 每次判定写入，
> `src/web/api.ts` 的 `/api/audit` 读取）。下文表格保留原样作为历史记录，不再代表现状。

## 一、重要决策

| 决策 | 理由 |
|------|------|
| 安全模块独立 `src/security/` 目录 | 安全是横切关注点，与业务模块分开放置更清晰 |
| 审计日志用 JSONL 文件而非 DB | append-only 不可篡改，比 DB 行更安全（无 UPDATE/DELETE 路径） |
| API Key 用 SHA256 哈希存储 | 明文永不在 DB/日志中出现，仅 `.env` 白名单读取 |
| 长期记忆用 SQLite 表 | 利用现有 DB 基础设施，无需引入向量库 |
| 记忆衰减用指数衰减函数 | `importance * exp(-decayRate * age / halfLife)`，7 天半衰期 |
| Fallback 链用熔断器模式 | 连续失败 3 次后 30 秒冷却，避免雪崩 |
| Token 预算用中英文字符比例估算 | 无需引入 tokenizer 依赖，简单可行 |
| 富媒体用平台策略模式 | 同一 RichCard 按 Telegram/Discord/Slack/CLI/Web 输出不同格式 |

## 二、所遇问题与修复方案

| # | 问题 | 修复 |
|---|------|------|
| 1 | `input-guard.ts` 正则 `/\[/ ?system ?\]/i` 语法错误 | 简化为 `/\[system\]/i` |
| 2 | `fallback.ts` 数组索引 `cfg` 可能 undefined | 加 `!` 非空断言 |
| 3 | `token-budget.ts` 数组索引可能 undefined | 加 `!` 非空断言 |
| 4 | `audit.ts` 数组索引可能 undefined | 加 `!` 非空断言 |
| 5 | `content-filter.ts` split 结果可能 undefined | 加 `!` 非空断言 |



| 扩展 | 知识文档映射 |
|------|-------------|
| Prompt 注入防御 | 04-Agent应用详解 §4.11 Agent安全 |
| 内容安全过滤 | 04-Agent应用详解 §4.11 Agent安全 |
| 审计日志 | 05-后端工程详解 §5.2 审计与可观测性 |
| API Key 管理 | 05-后端工程详解 §5.1 密钥管理 |
| Docker Compose | 05-后端工程详解 §5.5 容器化部署 |
| 健康检查 | 05-后端工程详解 §5.3 健康检查 |
| 备份恢复 | 05-后端工程详解 §5.4 数据备份 |
| 长期记忆 | 04-Agent应用详解 §4.9 记忆系统 |
| 会话摘要 | 04-Agent应用详解 §4.6 上下文工程 |
| Fallback 链 | 04-Agent应用详解 §3.3 Provider 抽象 |
| Token 预算 | 04-Agent应用详解 §4.6 上下文工程 |
| 通知系统 | 04-Agent应用详解 §4.12 Human-in-the-Loop |
| 富媒体消息 | 04-Agent应用详解 §4.10 交互式问题 |

---

## 修改记录
- 2026-08-24 创建（阶段 11：文档之外扩展方向——5 类 13 个文件）
