/**
 * modules/index.ts —— 模块自注册 barrel（import 顺序即契约）
 *
 * 职责：副作用导入全部模块；approvals 必须先于 self-mod（self-mod 的 requestHold 依赖 approvals）。
 * 关键导出：无（副作用模块）
 * 借鉴：nanoclaw src/modules/index.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2，空 barrel）
 *   2026-08-12 阶段 6：接入 typing/permissions/approvals/scheduling/agent-to-agent/interactive/self-mod/memory-kb/observability/quota
 */
import "./typing.js";
import "./permissions.js";
import "./approvals.js";
import "./scheduling.js";
import "./agent-to-agent.js";
import "./interactive.js";
import "./self-mod.js";
import "./memory-kb.js";
import "./observability.js";
import "./mount-security.js";
import "./quota.js";

export {};

/*
 * 修改记录：
 *   2026-08-24 补齐未完成清单：添加 mount-security 模块导入
 */
