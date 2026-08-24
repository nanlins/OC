/**
 * response-registry.ts —— 响应处理器注册表
 *
 * 职责：注册交互式问题响应处理器（onAction 回调的分发）。模块通过
 *       registerResponseHandler 注册处理器，ask_question 响应到达时按序调用。
 * 关键导出：registerResponseHandler, getResponseHandlers, ResponsePayload, ResponseHandler
 * 借鉴：nanoclaw src/response-registry.ts
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */

export interface ResponsePayload {
  questionId: string;
  value: string;
  userId: string | null;
  channelType: string;
  platformId: string;
  threadId: string | null;
}

export type ResponseHandler = (payload: ResponsePayload) => Promise<boolean>;

const responseHandlers: ResponseHandler[] = [];

export function registerResponseHandler(handler: ResponseHandler): void {
  responseHandlers.push(handler);
}

export function getResponseHandlers(): readonly ResponseHandler[] {
  return responseHandlers;
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

