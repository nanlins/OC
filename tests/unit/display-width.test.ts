/**
 * display-width.test.ts -- East Asian terminal width unit tests (P2-3).
 *
 * Responsibility: pin the shared width model that every aligned terminal surface
 * depends on (CLI tables, help pages, brand chrome). The bug this guards is
 * String.length counting a CJK character as 1 while the terminal gives it 2 columns.
 *
 * Modification record:
 *   2026-10-06  Created (P2-3)
 */
import { describe, expect, it } from "vitest";
import { displayWidth, isWideCodePoint, padEndWidth, stripAnsi, truncateToWidth } from "../../src/display-width.js";
import { renderTable, formatLocalTime, localizeIsoTimestamps } from "../../src/cli/format.js";

const ESC = String.fromCharCode(0x1b);

describe("displayWidth", () => {
  it("counts ASCII as one column per character", () => {
    expect(displayWidth("")).toBe(0);
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("hello world")).toBe(11);
  });

  it("counts CJK as two columns per character", () => {
    expect(displayWidth("中文")).toBe(4);
    expect(displayWidth("日本語")).toBe(6);
    expect(displayWidth("한국어")).toBe(6);
  });

  it("counts mixed text as the sum of both", () => {
    expect(displayWidth("ab中文cd")).toBe(8);
    expect(displayWidth("会话 agent")).toBe(4 + 1 + 5);
  });

  it("ignores ANSI escape sequences", () => {
    expect(displayWidth(`${ESC}[31mred${ESC}[0m`)).toBe(3);
    expect(displayWidth(`${ESC}[1;38;2;43;111;220m中文${ESC}[0m`)).toBe(4);
  });

  it("ignores control characters and zero-width marks", () => {
    expect(displayWidth("a\u0007b")).toBe(2);
    expect(displayWidth("a\u200bb")).toBe(2); // zero-width space
    expect(displayWidth("e\u0301")).toBe(1); // e + combining acute = one column
  });

  it("counts astral characters once, not as a surrogate pair", () => {
    expect(displayWidth("\u{1F600}")).toBe(2); // emoji is wide
    expect(isWideCodePoint(0x1f600)).toBe(true);
    expect(isWideCodePoint(0x4e2d)).toBe(true);
    expect(isWideCodePoint(0x61)).toBe(false);
  });
});

describe("stripAnsi", () => {
  it("removes SGR sequences and leaves plain text", () => {
    expect(stripAnsi(`${ESC}[32mok${ESC}[0m`)).toBe("ok");
    expect(stripAnsi("plain")).toBe("plain");
  });
});

describe("padEndWidth", () => {
  it("pads by columns, so CJK and ASCII lines end at the same column", () => {
    expect(padEndWidth("中文", 6)).toBe("中文  "); // 4 columns + 2 spaces
    expect(padEndWidth("abcd", 6)).toBe("abcd  ");
    expect(displayWidth(padEndWidth("中文", 6))).toBe(6);
    expect(displayWidth(padEndWidth("abcd", 6))).toBe(6);
  });

  it("never truncates when the string already exceeds the width", () => {
    expect(padEndWidth("中文中文", 3)).toBe("中文中文");
  });
});

describe("truncateToWidth", () => {
  it("leaves short strings untouched", () => {
    expect(truncateToWidth("abc", 10)).toBe("abc");
    expect(truncateToWidth("中文", 10)).toBe("中文");
  });

  it("appends an ellipsis and stays within budget", () => {
    const out = truncateToWidth("abcdefghij", 6);
    expect(displayWidth(out)).toBeLessThanOrEqual(6);
    expect(out.endsWith("\u2026")).toBe(true);
  });

  it("never splits a wide character", () => {
    const out = truncateToWidth("中文字符", 5);
    expect(displayWidth(out)).toBeLessThanOrEqual(5);
    // budget 5 -> 4 columns of text + ellipsis; two CJK chars fit exactly
    expect(out).toBe("中文\u2026");
  });

  it("handles a zero or negative budget", () => {
    expect(truncateToWidth("abc", 0)).toBe("");
    expect(truncateToWidth("abc", -3)).toBe("");
  });
});

describe("renderTable: CJK alignment (P2-3 regression)", () => {
  /** Column start offsets, read off the rule row (dashes separated by two spaces). */
  function columnStarts(ruleRow: string): number[] {
    const starts: number[] = [];
    let offset = 0;
    for (const part of ruleRow.split("  ")) {
      starts.push(offset);
      offset += displayWidth(part) + 2;
    }
    return starts;
  }

  /** Take the first `n` display columns (no ANSI in table output, so this is a plain scan). */
  function sliceWidth(s: string, n: number): string {
    let out = "";
    let used = 0;
    for (const ch of s) {
      const w = displayWidth(ch);
      if (used + w > n) break;
      out += ch;
      used += w;
    }
    return out;
  }

  it("starts every column at the same offset when cells mix CJK and ASCII", () => {
    const out = renderTable([
      { name: "demo", folder: "demo", note: "默认组" },
      { name: "a-very-long-name", folder: "f2", note: "x" },
      { name: "中文名字", folder: "目录二", note: "备注" },
    ]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(5); // header + rule + 3 rows
    const starts = columnStarts(lines[1]!);
    expect(starts).toHaveLength(3);

    for (const line of [lines[0]!, ...lines.slice(2)]) {
      for (const offset of starts) {
        // Content must begin exactly at the column offset -- a CJK cell one column
        // wider than String.length thinks is what used to shift everything after it.
        const before = sliceWidth(line, offset);
        const at = line.slice(before.length).charAt(0);
        expect(at, `column at ${offset} in ${JSON.stringify(line)}`).not.toBe(" ");
        expect(at).not.toBe("");
      }
    }
  });

  it("sizes the rule row from display width, not character count", () => {
    const out = renderTable([{ 名称: "值" }]);
    const [header, rule] = out.split("\n") as [string, string];
    expect(displayWidth(rule)).toBe(displayWidth(header));
    // "名称" is 4 columns, so the rule must be 4 dashes, not 2.
    expect(rule).toBe("----");
  });

  it("trims trailing padding so rows do not carry invisible whitespace", () => {
    const out = renderTable([{ a: "x", b: "y" }]);
    for (const line of out.split("\n")) {
      expect(line).toBe(line.replace(/\s+$/, ""));
    }
  });

  it("reports an empty result set", () => {
    expect(renderTable([])).toBe("(no rows)");
  });
});

describe("localizeIsoTimestamps: accepted instant shapes (P2-3)", () => {
  it("localizes a Z instant", () => {
    const out = localizeIsoTimestamps("2026-10-06T05:24:13.228Z");
    expect(typeof out).toBe("string");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("localizes an explicit numeric offset", () => {
    const withColon = localizeIsoTimestamps("2026-10-06T13:24:13+08:00");
    const compact = localizeIsoTimestamps("2026-10-06T13:24:13+0800");
    expect(withColon).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(compact).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // Same instant, same rendering.
    expect(withColon).toBe(compact);
  });

  it("treats a naive timestamp as local wall-clock time and round-trips it", () => {
    const naive = "2026-10-06T13:24:13";
    expect(localizeIsoTimestamps(naive)).toBe("2026-10-06 13:24:13");
  });

  it("leaves non-timestamps and embedded timestamps alone", () => {
    expect(localizeIsoTimestamps("hello")).toBe("hello");
    expect(localizeIsoTimestamps("2026-10-06")).toBe("2026-10-06"); // date-only is not an instant
    expect(localizeIsoTimestamps("at 2026-10-06T05:24:13Z ok")).toBe("at 2026-10-06T05:24:13Z ok");
    expect(localizeIsoTimestamps("not-a-date")).toBe("not-a-date");
  });

  it("recurses into arrays and objects but not into longer strings", () => {
    const out = localizeIsoTimestamps({ a: ["2026-10-06T05:24:13Z"], b: { c: 1 } }) as Record<string, unknown>;
    expect(Array.isArray(out.a)).toBe(true);
    expect((out.a as string[])[0]).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(out.b).toEqual({ c: 1 });
  });

  it("formatLocalTime renders a Date in local time with zero padding", () => {
    const d = new Date(2026, 0, 5, 9, 8, 7); // local-time constructor, no TZ ambiguity
    expect(formatLocalTime(d)).toBe("2026-01-05 09:08:07");
  });
});

/*
 * Modification record:
 *   2026-10-06  Created (P2-3)
 */
