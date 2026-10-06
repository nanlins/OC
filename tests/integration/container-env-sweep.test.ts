/**
 * container-env-sweep.test.ts -- stale provider-secret file cleanup (P2-2).
 *
 * Responsibility: prove the startup sweep removes `.container-env-*` files left behind
 * when a previous host died before its container-close callbacks could run, and that
 * it leaves everything else in DATA_DIR alone.
 *
 * These files hold real provider credentials in plaintext (mode 0600), so a leftover
 * is a secret-at-rest leak. Only synthetic values are written here.
 *
 * Modification record:
 *   2026-10-06  Created (P2-2)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "../../src/config.js";
import { sweepStaleEnvFiles } from "../../src/container-runner.js";

const LEFTOVERS = [".container-env-oc-old-1", ".container-env-oc-old-2"];

function writeLeftover(name: string, content = "OPENAI_API_KEY=fake-not-a-real-key\n"): string {
  mkdirSync(DATA_DIR, { recursive: true });
  const p = join(DATA_DIR, name);
  writeFileSync(p, content);
  return p;
}

beforeEach(() => {
  mkdirSync(DATA_DIR, { recursive: true });
});

afterEach(() => {
  for (const n of [...LEFTOVERS, ".container-env-keep-test", "unrelated.txt", "container-env-oc-old-1"]) {
    try {
      rmSync(join(DATA_DIR, n), { force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("P2-2: sweepStaleEnvFiles", () => {
  it("removes leftover .container-env-* files and reports the count", () => {
    const paths = LEFTOVERS.map((n) => writeLeftover(n));
    for (const p of paths) expect(existsSync(p)).toBe(true);

    const removed = sweepStaleEnvFiles();

    expect(removed).toBeGreaterThanOrEqual(2);
    for (const p of paths) expect(existsSync(p), p).toBe(false);
  });

  it("leaves unrelated DATA_DIR content untouched", () => {
    const keep = writeLeftover("unrelated.txt", "not a secret file\n");
    const stale = writeLeftover(".container-env-oc-old-1");

    sweepStaleEnvFiles();

    expect(existsSync(keep)).toBe(true);
    expect(readFileSync(keep, "utf8")).toBe("not a secret file\n");
    expect(existsSync(stale)).toBe(false);
  });

  it("is idempotent -- a second sweep finds nothing", () => {
    writeLeftover(".container-env-oc-old-1");
    expect(sweepStaleEnvFiles()).toBeGreaterThanOrEqual(1);
    // Only counts files matching the prefix; with none left the count is 0.
    expect(sweepStaleEnvFiles()).toBe(0);
  });

  it("does not throw when DATA_DIR holds no matches", () => {
    expect(() => sweepStaleEnvFiles()).not.toThrow();
  });

  it("does not match a merely similar filename", () => {
    const near = writeLeftover("container-env-oc-old-1"); // no leading dot
    const before = existsSync(near);
    sweepStaleEnvFiles();
    expect(before).toBe(true);
    expect(existsSync(near)).toBe(true);
  });
});

/*
 * Modification record:
 *   2026-10-06  Created (P2-2)
 */
