/**
 * guard/index.ts —— guard 模块 barrel
 *
 * 职责：统一导出决策函数/定义派生动作目录/ALLOW/DENY/HOLD/unguarded/GuardDenyError。
 * 关键导出：见下。
 * 核心模式：决策函数 + 模块边缘注入 decide；咨询携带值而非名字。
 * 借鉴：nanoclaw src/guard/index.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
export * from "./types.js";
export * from "./guard-actions.js";
export * from "./guard.js";
