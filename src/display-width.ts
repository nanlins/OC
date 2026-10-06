/**
 * display-width.ts -- terminal column width for mixed ASCII/CJK text.
 *
 * Responsibility: one shared answer to "how many terminal columns does this string
 * occupy?", plus width-aware pad/truncate helpers. Every place that aligns text in
 * the terminal (CLI tables, help pages, brand chrome, the chat TUI cursor math) must
 * use this instead of String.length / String.padEnd.
 *
 * Key exports: displayWidth, padEndWidth, truncateToWidth, stripAnsi, isWideCodePoint
 *
 * Why it matters: `String.length` counts UTF-16 code units, so a Chinese label counts
 * as 1 per character while occupying 2 terminal columns. Any padEnd/length-based
 * alignment drifts by one column per CJK character, which is exactly why tables and
 * help pages containing Chinese came out ragged (P2-3).
 *
 * Invariant: pure functions, no I/O. ANSI SGR sequences are stripped before measuring
 * so colored text aligns with plain text.
 *
 * Modification record:
 *   2026-10-06  Created (P2-3: shared East Asian display width)
 */

// Built via RegExp ctor because eslint's no-control-regex rejects a literal ESC in a
// regex literal; the escape character has to appear in the pattern to strip SGR sequences.
const ANSI_RE = new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*[A-Za-z]", "g");

/** Remove ANSI escape sequences so width math sees only printable text. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/**
 * East Asian Wide / Fullwidth ranges (2 columns) plus the common emoji blocks.
 * Deliberately a range list rather than a per-codepoint table: it covers CJK,
 * kana, hangul, fullwidth forms and emoji, which is what this project renders.
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul compat, CJK compat
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables / Radicals
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical Forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms, Small Form Variants
  [0xff00, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6], // Fullwidth cent/pound/won signs etc.
  [0x1b000, 0x1b001], // Kana Supplement
  [0x1f300, 0x1f64f], // Misc Symbols and Pictographs, Emoticons
  [0x1f900, 0x1f9ff], // Supplemental Symbols and Pictographs
  [0x20000, 0x3fffd], // CJK Unified Ideographs Extension B and beyond
];

/** Zero-width: combining marks and the usual invisible format characters. */
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x200b, 0x200f], // ZWSP, ZWNJ, ZWJ, LRM, RLM
  [0x2060, 0x2064], // Word joiner, invisible operators
  [0xfe00, 0xfe0f], // Variation Selectors
  [0xfeff, 0xfeff], // BOM / ZWNBSP
];

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

export function isWideCodePoint(cp: number): boolean {
  return inRanges(cp, WIDE_RANGES);
}

function isZeroWidthCodePoint(cp: number): boolean {
  return inRanges(cp, ZERO_WIDTH_RANGES);
}

/**
 * Terminal column count. Iterates code points (not UTF-16 units) so astral characters
 * such as emoji and CJK Extension B count once, and skips surrogate halves.
 */
export function displayWidth(s: string): number {
  let width = 0;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue; // control characters
    if (isZeroWidthCodePoint(cp)) continue;
    width += isWideCodePoint(cp) ? 2 : 1;
  }
  return width;
}

/** padEnd that accounts for display width; never truncates. */
export function padEndWidth(s: string, width: number): string {
  const pad = width - displayWidth(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

/**
 * Truncate to a column budget, appending an ellipsis when something was dropped.
 * Cuts on code-point boundaries and re-measures, so a wide character is never split.
 */
export function truncateToWidth(s: string, max: number): string {
  if (max <= 0) return "";
  if (displayWidth(s) <= max) return s;
  const plain = stripAnsi(s);
  const budget = max - 1; // reserve one column for the ellipsis
  let out = "";
  let used = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const w = isZeroWidthCodePoint(cp) ? 0 : isWideCodePoint(cp) ? 2 : 1;
    if (used + w > budget) break;
    out += ch;
    used += w;
  }
  return out + "\u2026";
}

/*
 * Modification record:
 *   2026-10-06  Created (P2-3: shared East Asian display width)
 */
