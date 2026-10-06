/**
 * env-write.test.ts -- .env helper unit tests, focused on key masking (P1-1).
 *
 * Responsibility: pin maskKey so a masked value can never carry enough of the secret
 * to be usable or correlatable. Only synthetic keys are used here -- no real
 * credential is read from .env and none can reach a snapshot.
 *
 * Modification record:
 *   2026-10-06  Created (P1-1)
 */
import { describe, expect, it } from "vitest";
import { maskKey } from "../../src/env-write.js";

describe("maskKey", () => {
  it("reports an unset key distinctly from a set one", () => {
    expect(maskKey(null)).toBe("(未设置)");
    expect(maskKey("")).toBe("(未设置)");
  });

  it("masks short keys entirely", () => {
    for (const k of ["a", "ab", "abcdefgh", "sk-123456", "abcdefghijkl"]) {
      expect(maskKey(k), k).toBe("***");
    }
  });

  it("shows only a 3-char head and 4-char tail for a long key", () => {
    const masked = maskKey("sk-92c4abcdef1234567890");
    expect(masked).toBe("sk-...7890");
  });

  it("never leaks the middle of the secret", () => {
    const secret = "sk-92c4SECRETMIDDLEabcdef1234567890";
    const masked = maskKey(secret);
    expect(masked).not.toContain("SECRET");
    expect(masked).not.toContain("MIDDLE");
    // The masked form must be strictly shorter than the secret.
    expect(masked.length).toBeLessThan(secret.length);
  });

  it("does not expose a 6-character prefix any more (the P1-1 regression)", () => {
    // The old implementation returned `${v.slice(0, 6)}…***`, i.e. "sk-92c…***".
    const masked = maskKey("sk-92c4abcdef1234567890");
    expect(masked).not.toContain("sk-92c");
    expect(masked.startsWith("sk-...")).toBe(true);
  });

  it("keeps the boundary exact at 13 characters", () => {
    expect(maskKey("abcdefghijkl")).toBe("***"); // 12 chars -> fully masked
    expect(maskKey("abcdefghijklm")).toBe("abc...jklm"); // 13 chars -> head+tail
  });

  it("is stable for repeated calls (no hidden state)", () => {
    const k = "sk-test-0123456789abcdef";
    expect(maskKey(k)).toBe(maskKey(k));
  });
});

/*
 * Modification record:
 *   2026-10-06  Created (P1-1)
 */
