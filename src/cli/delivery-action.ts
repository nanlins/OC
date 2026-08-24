/**
 * cli/delivery-action.ts —— CLI 投递动作注册
 *
 * 职责：注册 CLI 通道的投递动作（如交互式问题渲染），供 delivery.ts 在投递
 *       outbound 消息时查询并执行。与通道适配器的 deliver 分开——此处理特定
 *       消息类型（ask_question / card）的 CLI 渲染。
 * 关键导出：registerCliDeliveryAction, getCliDeliveryAction, CliDeliveryAction
 * 借鉴：nanoclaw src/cli/ 的 delivery-action 模式
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */

export interface CliDeliveryAction {
  type: string;
  handler: (payload: Record<string, unknown>) => string | Promise<string>;
}

const actions = new Map<string, CliDeliveryAction>();

export function registerCliDeliveryAction(action: CliDeliveryAction): void {
  if (actions.has(action.type)) throw new Error(`duplicate cli delivery action: ${action.type}`);
  actions.set(action.type, action);
}

export function getCliDeliveryAction(type: string): CliDeliveryAction | undefined {
  return actions.get(type);
}

export function listCliDeliveryActionTypes(): string[] {
  return [...actions.keys()];
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

