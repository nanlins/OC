/**
 * timezone-lite.ts —— 容器侧时区工具（宿主 src/timezone.ts 的字节级镜像子集）
 *
 * 职责：isValidTimezone/resolveTimezone（存储 ISO-UTC、显示本地化规则在容器侧落地）。
 * 关键导出：resolveTimezone, isValidTimezone
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(candidate: string | null): string {
  if (candidate && isValidTimezone(candidate)) return candidate;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
