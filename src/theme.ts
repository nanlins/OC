/**
 * theme.ts -- OC brand palette for the terminal.
 *
 * Colors derived from OC brand identity:
 *   brand blue  -- primary accent
 *   brand green -- secondary accent for "you" role
 *
 * Rendering gates:
 *   - No TTY (piped / redirected) -> plain text, no ANSI
 *   - NO_COLOR set               -> plain text, no ANSI
 *   - COLORTERM truecolor/24bit  -> 24-bit ANSI (exact brand colors)
 *   - Otherwise                  -> kleur's 16-color fallback
 *
 * Key exports: brand, brandBold, brandChip, accentGreen, fitToWidth, wrapForGutter
 * Invariant: all color functions are pure; width helpers read stdout.columns at call time.
 *
 * Referenced: nanoclaw setup/lib/theme.ts
 */
import k from "kleur";
import { displayWidth, truncateToWidth } from "./display-width.js";

const USE_ANSI = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const TRUECOLOR = USE_ANSI && (process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit");

/* OC brand colors: blue primary #2B6FDC, green accent #3FBA50 */
export function brand(s: string): string {
  if (!USE_ANSI) return s;
  if (TRUECOLOR) return `\x1b[38;2;43;111;220m${s}\x1b[0m`;
  return k.blue(s);
}

export function brandBold(s: string): string {
  if (!USE_ANSI) return s;
  if (TRUECOLOR) return `\x1b[1;38;2;43;111;220m${s}\x1b[0m`;
  return k.bold(k.blue(s));
}

export function brandChip(s: string): string {
  if (!USE_ANSI) return s;
  if (TRUECOLOR) {
    return `\x1b[48;2;43;111;220m\x1b[38;2;255;255;255m\x1b[1m${s}\x1b[0m`;
  }
  return k.bgBlue(k.white(k.bold(s)));
}

export function accentGreen(s: string): string {
  if (!USE_ANSI) return s;
  if (TRUECOLOR) return `\x1b[38;2;63;186;80m${s}\x1b[39m`;
  return k.green(s);
}

export function dim(s: string): string {
  if (!USE_ANSI) return s;
  return k.gray(s);
}

/**
 * Truncate a label so base + reserved suffix fits the terminal width.
 * Uses displayWidth/truncateToWidth (P2-3): a CJK label occupies two columns per
 * character, so slicing by String.length overran the budget and broke spinner redraws.
 *
 * `suffix` is the space reserved for what the caller appends afterwards (e.g. " (999s)");
 * it is measured but not included in the return value.
 */
export function fitToWidth(base: string, suffix: string): string {
  const cols = process.stdout.columns ?? 80;
  // Reserve: spinner icon (1) + 2 padding spaces + clack's animated ellipsis (up to 3)
  // + 1 column safety margin = 7, plus whatever the caller will append.
  const budget = Math.max(20, cols - 7 - displayWidth(suffix));
  return truncateToWidth(base, budget);
}

/** Hard-wrap one logical line at word boundaries, measured in terminal columns. */
function wrapLine(line: string, width: number): string {
  if (displayWidth(line) <= width) return line;
  const rows: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const word of line.split(" ")) {
    const wLen = displayWidth(word);
    if (curLen === 0) {
      cur = word;
      curLen = wLen;
    } else if (curLen + 1 + wLen <= width) {
      cur += " " + word;
      curLen += 1 + wLen;
    } else {
      rows.push(cur);
      cur = word;
      curLen = wLen;
    }
  }
  if (cur) rows.push(cur);
  return rows.join("\n");
}

/**
 * Wrap text so it fits inside a gutter without the terminal's soft wrap breaking the
 * left-hand bar. `gutter` is the horizontal overhead the surrounding chrome adds.
 */
export function wrapForGutter(text: string, gutter: number): string {
  const cols = process.stdout.columns ?? 80;
  const width = Math.max(30, cols - gutter);
  return text
    .split("\n")
    .map((line) => wrapLine(line, width))
    .join("\n");
}

/*
 * Modification record:
 *   2026-10-04  Created (P0-1: unified brand theme, modeled on nanoclaw setup/lib/theme.ts)
 *   2026-10-06  P2-3: width math delegated to src/display-width.ts (CJK-aware);
 *               fitToWidth now truncates on code-point boundaries via truncateToWidth
 */
