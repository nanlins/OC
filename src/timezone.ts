/**
 * timezone.ts —— 时区工具（存储 ISO-UTC，显示本地化）
 *
 * 职责：IANA 校验、候选链解析、本地化显示、带时区墙钟时间反解 UTC。
 * 关键导出：isValidTimezone, resolveTimezone, formatLocalTime, formatLocalStamp, parseZonedToUtc
 * 承重不变量：DB 存储一律 ISO-8601 UTC；仅显示层本地化（纯 Intl API 零依赖）。
 * 借鉴：nanoclaw src/timezone.ts（字节级对齐的宿主镜像）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
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

/** 候选链：显式参数 > .env TZ > process.env.TZ > 系统默认 > UTC */
export function resolveTimezone(candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    if (c && isValidTimezone(c)) return c;
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** 散文式本地时间（en-US），供 agent/用户阅读 */
export function formatLocalTime(isoUtc: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(isoUtc));
  } catch {
    return isoUtc;
  }
}

/** 日志行本地时间戳（sv-SE => YYYY-MM-DD HH:mm） */
export function formatLocalStamp(isoUtc: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(isoUtc));
  } catch {
    return isoUtc;
  }
}

/**
 * 把"某时区的墙钟时间"反解为 UTC ISO（--process-after 复制显示值语义不变）。
 * 用 Intl.formatToParts 反推偏移；DST 边界误差可接受（借鉴 nanoclaw 注释）。
 */
export function parseZonedToUtc(naiveLocal: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(naiveLocal);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  // 估算该时区在 asUtc 时刻的偏移
  const offsetAt = (utcMs: number): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const zonedMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return zonedMs - utcMs;
  };
  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess); // 二次迭代收敛
  return new Date(guess).toISOString();
}
