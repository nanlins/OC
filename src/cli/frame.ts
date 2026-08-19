/**
 * cli/frame.ts —— CLI 线上协议帧
 *
 * 职责：RequestFrame/ResponseFrame 行分隔 JSON 协议；调用者身份不在帧里，由传输适配器填充。
 * 关键导出：RequestFrame, ResponseFrame, CallerContext
 * 借鉴：nanoclaw src/cli/frame.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 */
export interface CallerContext {
  actor: "host" | "agent";
  agentGroupId?: string;
  userId?: string;
  /** 审批重放标记：approve 后重放携带，guard 直接放行（审批即授权；仅 resources resolve 带外注入） */
  approved?: boolean;
  /** 重放上下文：禁止再发起 approvals resolve（防审批嵌套传递授权，P1 修复） */
  replaying?: boolean;
}

/** P0 修复（se-inspector）：帧不携带身份；caller 由传输适配器带外填充 */
export interface RequestFrame {
  /** "<resource> <verb> [id] [--flag value ...]" */
  cmd: string;
  requestId?: string;
}

export interface ResponseFrame {
  requestId?: string;
  ok: boolean;
  code?: "unknown-command" | "invalid-args" | "forbidden" | "approval-pending" | "handler-error" | "not-found";
  error?: string;
  data?: unknown;
  /** 服务端渲染的人类可读输出（客户端逐字打印） */
  human?: string;
}
