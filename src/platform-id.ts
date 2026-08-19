/**
 * platform-id.ts —— platform ID 命名空间化判定
 *
 * 职责：决定 platform ID 是否加通道前缀（写库形状必须与适配器日后发出的形状一致，否则路由静默丢失）。
 * 关键导出：namespacedPlatformId
 * 借鉴：nanoclaw src/platform-id.ts（简化：适配器显式声明是否加前缀，见补充优化 B 类）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */

/** 已有前缀/特殊形状原样；否则加 `<channel>:` 前缀 */
export function namespacedPlatformId(channel: string, raw: string, adapterNamespaces: boolean): string {
  if (!adapterNamespaces) return raw;
  if (raw.includes(":") || raw.startsWith("@") || raw.startsWith("+") || raw.startsWith("group:")) return raw;
  return `${channel}:${raw}`;
}
