/**
 * cli/format.ts -- output formatting for oc CLI commands.
 *
 * Two modes:
 *   - human (default): auto-table for arrays of flat records, JSON.stringify for
 *     everything else. Server-rendered once so every transport prints the same page.
 *   - json: the raw frame; clients use --json and ignore `human`.
 *
 * Key exports: renderTable, formatLocalTime, formatHuman, localizeIsoTimestamps
 * Invariant: column alignment uses displayWidth/padEndWidth, never String.length/padEnd,
 *   so tables containing CJK stay aligned (P2-3).
 *
 * Referenced: nanoclaw src/cli/format.ts
 *
 * Modification record:
 *   2026-10-04  Created (P0-3: CLI table formatting)
 *   2026-10-06  P2-3: CJK-aware table alignment; localizeIsoTimestamps now accepts
 *               Z, numeric offsets (+08:00) and naive (no timezone) instants;
 *               P2-1: dead exports formatResponse and FormatMode removed -- the client
 *               does its own frame printing, so nothing ever consumed them
 */
import { displayWidth, padEndWidth } from "../display-width.js";

/**
 * A string is treated as a display timestamp only when the WHOLE value is an ISO-8601
 * instant; embedded occurrences inside longer strings may be machine payloads and stay raw.
 *
 * Accepted shapes (P2-3):
 *   2026-10-06T05:24:13.228Z      -- what the host writes (toISOString)
 *   2026-10-06T13:24:13+08:00     -- explicit numeric offset
 *   2026-10-06T13:24:13           -- naive; JS parses date-time-without-offset as LOCAL
 *                                    wall-clock time, so formatting it back to local
 *                                    round-trips to the same reading (intended).
 */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Convert an ISO instant to a local "YYYY-MM-DD HH:mm:ss" stamp for human display. */
export function localizeIsoTimestamps(value: unknown): unknown {
  if (typeof value === "string") {
    if (!ISO_INSTANT_RE.test(value)) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : formatLocalTime(d);
  }
  if (Array.isArray(value)) return value.map(localizeIsoTimestamps);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, localizeIsoTimestamps(v)]),
    );
  }
  return value;
}

/** Format a Date as local "YYYY-MM-DD HH:mm:ss". */
export function formatLocalTime(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function formatHuman(rawData: unknown): string {
  const data = localizeIsoTimestamps(rawData);
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;
  if (Array.isArray(data) && data.every(isFlatRecord)) {
    return renderTable(data as Record<string, unknown>[]);
  }
  return JSON.stringify(data, null, 2);
}

function isFlatRecord(x: unknown): x is Record<string, unknown> {
  if (!x || typeof x !== "object") return false;
  for (const v of Object.values(x as Record<string, unknown>)) {
    if (v !== null && typeof v === "object") return false;
  }
  return true;
}

/**
 * Align an array of flat records into a text table.
 * Widths come from displayWidth so a CJK cell does not push its column out of line.
 * The rule row uses ASCII "-" on purpose: U+2500 is East Asian *Ambiguous* width and
 * renders as 2 columns on some CJK terminals, which would break the very alignment
 * this function exists to guarantee.
 */
export function renderTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(no rows)";
  const cols = Object.keys(rows[0]!);
  const cells = rows.map((r) => cols.map((c) => String(r[c] ?? "")));
  const widths = cols.map((c, i) => Math.max(displayWidth(c), ...cells.map((row) => displayWidth(row[i]!))));
  const fmtRow = (vals: string[]): string =>
    vals
      .map((v, i) => padEndWidth(v, widths[i]!))
      .join("  ")
      .replace(/\s+$/, "");
  return [fmtRow(cols), fmtRow(widths.map((w) => "-".repeat(w))), ...cells.map(fmtRow)].join("\n");
}

/*
 * Modification record:
 *   2026-10-04  Created (P0-3: CLI table formatting)
 *   2026-10-06  P2-3: CJK-aware alignment + broader timestamp parsing;
 *               P2-1: dropped dead formatResponse / FormatMode
 */
