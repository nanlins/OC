/**
 * cli-client.test.ts -- oc client unit tests (P0-4, P0-5, P1-5).
 *
 * Responsibility: pin the client-side contracts that do not need a live socket --
 * argv parsing, --json frame shaping, --stdin-json frame parsing and its TTY guard,
 * and the transport-error guidance for every "host not reachable" errno.
 * The single-print behaviour of main() against a real host is covered in
 * tests/integration/cli.test.ts.
 *
 * Modification record:
 *   2026-10-06  Created (P0-4 / P0-5 / P1-5)
 */
import { describe, expect, it } from "vitest";
import { main, parseStdinFrame, stripHuman } from "../../src/cli/client.js";
import { parseArgv } from "../../src/cli/parse-argv.js";
import { formatTransportError, isUnreachableCode, UNREACHABLE_CODES } from "../../src/cli/transport-errors.js";
import type { ResponseFrame } from "../../src/cli/frame.js";

/** Collect everything the client writes so we can assert on print counts. */
function sink(): { write: (s: string) => number; text: () => string } {
  let buf = "";
  return {
    write: (s: string) => {
      buf += s;
      return s.length;
    },
    text: () => buf,
  };
}

describe("parseArgv", () => {
  it("strips client-only flags and space-joins the rest into the wire cmd", () => {
    expect(parseArgv(["groups", "list", "--json"])).toMatchObject({
      cmd: "groups list",
      json: true,
      stdinJson: false,
    });
    expect(parseArgv(["groups", "create", "--name", "G", "--stdin-json"]).cmd).toBe("groups create --name G");
  });

  it("keeps host flags verbatim (the host parses them, not the client)", () => {
    const p = parseArgv(["approvals", "resolve", "abc", "--decision", "approve"]);
    expect(p.cmd).toBe("approvals resolve abc --decision approve");
    expect(p.json).toBe(false);
  });

  it("handles an empty argv", () => {
    expect(parseArgv([])).toMatchObject({ cmd: "", json: false, stdinJson: false });
  });

  it("does not treat --json as a positional", () => {
    expect(parseArgv(["--json", "sessions", "list"]).tokens).toEqual(["sessions", "list"]);
  });
});

describe("stripHuman (P1-5: --json is machine structure only)", () => {
  it("drops the human field from a successful frame", () => {
    const frame: ResponseFrame = { requestId: "r1", ok: true, data: { a: 1 }, human: "a table" };
    const out = stripHuman(frame);
    expect(out).not.toHaveProperty("human");
    expect(out).toEqual({ ok: true, requestId: "r1", data: { a: 1 } });
  });

  it("drops the human field from an error frame but keeps code and error", () => {
    const frame: ResponseFrame = { ok: false, code: "invalid-args", error: "missing id", human: "usage: ..." };
    const out = stripHuman(frame);
    expect(out).not.toHaveProperty("human");
    expect(out.code).toBe("invalid-args");
    expect(out.error).toBe("missing id");
  });

  it("omits absent optional fields instead of emitting undefined keys", () => {
    const out = stripHuman({ ok: true });
    expect(Object.keys(out)).toEqual(["ok"]);
  });

  it("serializes to valid JSON with no human key", () => {
    const json = JSON.stringify(stripHuman({ ok: true, data: [1, 2], human: "x" }));
    expect(json).not.toContain("human");
    expect(JSON.parse(json)).toEqual({ ok: true, data: [1, 2] });
  });
});

describe("parseStdinFrame (P1-5: --stdin-json has real behaviour)", () => {
  it("accepts the wire shape {cmd}", () => {
    expect(parseStdinFrame('{"cmd":"groups list"}')).toEqual({ cmd: "groups list", requestId: undefined });
  });

  it("accepts {command} as an alias and preserves a supplied requestId", () => {
    expect(parseStdinFrame('{"command":"sessions list","requestId":"fixed-1"}')).toEqual({
      cmd: "sessions list",
      requestId: "fixed-1",
    });
  });

  it("accepts a bare JSON string", () => {
    expect(parseStdinFrame('"groups list"')).toEqual({ cmd: "groups list", requestId: undefined });
  });

  it("tolerates surrounding whitespace and newlines (piped input)", () => {
    expect(parseStdinFrame('\n  {"cmd":"help"}\n')).toEqual({ cmd: "help", requestId: undefined });
  });

  it("rejects malformed JSON, empty input and frames without a command", () => {
    expect(parseStdinFrame("{not json")).toBeNull();
    expect(parseStdinFrame("")).toBeNull();
    expect(parseStdinFrame("   ")).toBeNull();
    expect(parseStdinFrame("{}")).toBeNull();
    expect(parseStdinFrame('{"cmd":""}')).toBeNull();
    expect(parseStdinFrame('{"cmd":123}')).toBeNull();
    expect(parseStdinFrame("null")).toBeNull();
    expect(parseStdinFrame("[1,2]")).toBeNull();
  });
});

describe("formatTransportError (P0-5)", () => {
  it("covers every unreachable errno with the same actionable guidance", () => {
    expect(UNREACHABLE_CODES).toEqual(["ENOENT", "ECONNREFUSED", "EPERM", "EACCES"]);
    for (const code of UNREACHABLE_CODES) {
      const out = formatTransportError(new Error(`connect ${code} \\\\.\\pipe\\oc-ctl-x`));
      expect(isUnreachableCode(code)).toBe(true);
      expect(out, code).toContain("cannot reach the OC host");
      expect(out, code).toContain("pnpm dev");
      expect(out, code).toContain("pnpm start");
      expect(out, code).toContain(code);
    }
  });

  it("handles the raw win32 named-pipe and unix socket message shapes", () => {
    expect(formatTransportError(new Error("connect ENOENT \\\\.\\pipe\\oc-ctl-a00706bf"))).toContain("pnpm dev");
    expect(formatTransportError(new Error("connect EACCES /data/ncl.sock"))).toContain("pnpm dev");
    expect(formatTransportError(new Error("listen EPERM"))).toContain("cannot reach the OC host");
  });

  it("accepts a non-Error throwable", () => {
    expect(formatTransportError("connect ECONNREFUSED")).toContain("cannot reach the OC host");
  });

  it("does not claim the host is down for an unrelated error", () => {
    const out = formatTransportError(new Error("ETIMEDOUT"));
    expect(out).toContain("transport error");
    expect(out).not.toContain("cannot reach the OC host");
    expect(isUnreachableCode("ETIMEDOUT")).toBe(false);
  });
});

describe("main: guards that fire before any socket is opened", () => {
  it("refuses --stdin-json on a TTY instead of hanging on an interactive prompt", async () => {
    const out = sink();
    const err = sink();
    const r = await main(["groups", "list"], {
      stdinJson: true,
      stdout: out,
      stderr: err,
      stdin: { isTTY: true },
    });
    expect(r).toEqual({ ok: false, exitCode: 1 });
    expect(err.text()).toContain("--stdin-json requires piped input");
    expect(out.text()).toBe("");
  });

  it("reports a missing command with the usage line, exactly once", async () => {
    const out = sink();
    const err = sink();
    const r = await main([], { stdout: out, stderr: err, stdin: { isTTY: false } });
    expect(r).toEqual({ ok: false, exitCode: 1 });
    expect(err.text()).toContain("no command given");
    expect(err.text()).toContain("usage:");
    // P0-4: one message, not a duplicate from an outer catch
    expect(err.text().match(/no command given/g)?.length).toBe(1);
    expect(out.text()).toBe("");
  });

  it("does not throw out of main for an anticipated failure (P0-4 single-print contract)", async () => {
    // Whatever happens, main resolves with an exit code; the entry point must never
    // need to reprint the error.
    await expect(main([], { stdout: sink(), stderr: sink(), stdin: { isTTY: true } })).resolves.toBeDefined();
    await expect(
      main(["--stdin-json"], { stdout: sink(), stderr: sink(), stdin: { isTTY: true } }),
    ).resolves.toMatchObject({ ok: false, exitCode: 1 });
  });
});

/*
 * Modification record:
 *   2026-10-06  Created (P0-4 / P0-5 / P1-5)
 */
