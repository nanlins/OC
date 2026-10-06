/**
 * cli-client-transport.test.ts -- oc client over a real control socket (P0-4, P1-5).
 *
 * Responsibility: prove the client's output contract end to end -- a failure prints
 * exactly once on stderr with exit code 1, a success prints the server-rendered
 * `human` exactly once, --json emits machine structure with no `human`, and
 * --stdin-json really reads a piped frame.
 *
 * Kept in its own file because it needs a live socket: tests/integration/cli.test.ts
 * drives dispatch through handleCliLine directly, and mixing the two lifecycles makes
 * the server start/stop race with the tests below.
 *
 * Two Windows/vitest hazards this file is written around:
 *   1. A named pipe is released asynchronously after close(), so the socket is bound
 *      ONCE in beforeAll instead of per test -- rebinding races the previous instance
 *      and fails with EADDRINUSE. (src/channels/cli.ts carries a wait-loop for the same
 *      reason on the chat socket.)
 *   2. Do NOT spawn `tsx` children from inside a vitest fork worker: a child connecting
 *      back into this worker's control socket took the fork down with "Worker exited
 *      unexpectedly". --stdin-json is therefore driven through an injected byte source,
 *      which still exercises the real readStdinAll -> parseStdinFrame -> socket path.
 *
 * Modification record:
 *   2026-10-06  Created (P0-4 / P1-5)
 */
import { connect } from "node:net";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  closeDb,
  initTestDb,
  runMigrations,
  migration001,
  migration002,
  createAgentGroup,
} from "../../src/db/index.js";
import { cliControlPath, startCliServer, stopCliServer } from "../../src/cli/socket-server.js";
import { main } from "../../src/cli/client.js";
import type { ResponseFrame } from "../../src/cli/frame.js";

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

/** Poll until the control socket accepts a connection (or the deadline passes). */
async function waitForControlSocket(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = connect(cliControlPath(), () => {
        s.destroy();
        resolve(true);
      });
      s.on("error", () => {
        s.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`control socket never became ready: ${cliControlPath()}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  startCliServer();
  await waitForControlSocket();
});

afterAll(async () => {
  // Awaited: on Windows the named pipe is released asynchronously, and the next test
  // file that binds it would otherwise hit EADDRINUSE.
  await stopCliServer();
});

beforeEach(() => {
  runMigrations(initTestDb(), [migration001, migration002]);
  createAgentGroup({ name: "T", folder: `t-${Math.random().toString(36).slice(2, 8)}` });
});

afterEach(() => {
  closeDb();
});

describe("wire protocol: line-delimited JSON frames over the control socket", () => {
  // Moved here from tests/integration/cli.test.ts: this file is the single owner of the
  // control socket's lifecycle. Two files binding the same Windows named pipe ran
  // concurrently (singleFork limits forks, not file parallelism) and the second bind
  // failed with EADDRINUSE.
  it("serves one request per line and answers with one JSON line", async () => {
    const res = await new Promise<ResponseFrame>((resolve, reject) => {
      const s = connect(cliControlPath(), () => {
        s.write(JSON.stringify({ cmd: "groups list", requestId: "wire-1" }) + "\n");
      });
      let buf = "";
      s.on("data", (c) => {
        buf += c.toString();
        const idx = buf.indexOf("\n");
        if (idx >= 0) {
          s.destroy();
          try {
            resolve(JSON.parse(buf.slice(0, idx)) as ResponseFrame);
          } catch (e) {
            reject(e);
          }
        }
      });
      s.on("error", reject);
      setTimeout(() => reject(new Error("socket timeout")), 5000);
    });
    expect(res.ok).toBe(true);
    expect(res.requestId).toBe("wire-1");
    expect((res.data as Array<Record<string, unknown>>).length).toBe(1);
    expect(typeof res.human).toBe("string");
  });

  it("accepts a bare command line that is not JSON", async () => {
    const res = await new Promise<ResponseFrame>((resolve, reject) => {
      const s = connect(cliControlPath(), () => {
        s.write("groups list\n");
      });
      let buf = "";
      s.on("data", (c) => {
        buf += c.toString();
        const idx = buf.indexOf("\n");
        if (idx >= 0) {
          s.destroy();
          resolve(JSON.parse(buf.slice(0, idx)) as ResponseFrame);
        }
      });
      s.on("error", reject);
      setTimeout(() => reject(new Error("socket timeout")), 5000);
    });
    expect(res.ok).toBe(true);
  });
});

describe("P0-4: the client prints a failure exactly once", () => {
  it("reports a missing id once, on stderr, and exits 1", async () => {
    const out = sink();
    const err = sink();

    const r = await main(["groups", "get"], { stdout: out, stderr: err, stdin: { isTTY: false } });

    expect(r).toEqual({ ok: false, exitCode: 1 });
    const combined = out.text() + err.text();
    expect(combined).toContain("missing id");
    // The regression: the data handler printed the error, then the outer catch printed
    // it again, so every failure showed up twice.
    expect(combined.match(/missing id/g)?.length).toBe(1);
    expect(out.text()).toBe("");
    expect(err.text()).toBe(combined);
  });

  it("reports an unknown command once with the resource's verbs", async () => {
    const out = sink();
    const err = sink();

    const r = await main(["groups", "frobnicate"], { stdout: out, stderr: err, stdin: { isTTY: false } });

    expect(r.exitCode).toBe(1);
    const combined = out.text() + err.text();
    expect(combined).toContain("no command");
    expect(combined.match(/no command/g)?.length).toBe(1);
  });

  it("reports an invalid-args failure together with its usage block, once", async () => {
    const err = sink();

    const r = await main(["groups", "create", "--name", "OnlyName"], {
      stdout: sink(),
      stderr: err,
      stdin: { isTTY: false },
    });

    expect(r.exitCode).toBe(1);
    expect(err.text()).toContain("usage: oc groups create");
    expect(err.text()).toContain("--folder");
    expect(err.text().match(/--name and --folder required/g)?.length).toBe(1);
  });
});

describe("P0-4 / P1-5: successful output", () => {
  it("prints the server-rendered human exactly once", async () => {
    const out = sink();
    const err = sink();

    const r = await main(["groups", "list"], { stdout: out, stderr: err, stdin: { isTTY: false } });

    expect(r).toEqual({ ok: true, exitCode: 0 });
    expect(err.text()).toBe("");
    expect(out.text()).toContain("name");
    expect(out.text().match(/name/g)?.length).toBe(1);
  });

  it("--json emits machine structure with no human field", async () => {
    const out = sink();

    const r = await main(["groups", "list", "--json"], { stdout: out, stderr: sink(), stdin: { isTTY: false } });

    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(out.text()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("human");
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.data)).toBe(true);
    expect((parsed.data as Array<Record<string, unknown>>).length).toBe(1);
  });

  it("--json on a failure still emits a parseable frame, not prose", async () => {
    const out = sink();

    const r = await main(["groups", "get", "--json"], { stdout: out, stderr: sink(), stdin: { isTTY: false } });

    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(out.text()) as Record<string, unknown>;
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("invalid-args");
    expect(parsed).not.toHaveProperty("human");
  });

  it("renders help through the same single-print path", async () => {
    const out = sink();

    const r = await main(["help"], { stdout: out, stderr: sink(), stdin: { isTTY: false } });

    expect(r.exitCode).toBe(0);
    expect(out.text()).toContain("OC CLI");
    expect(out.text().match(/OC CLI/g)?.length).toBe(1);
  });
});

describe("P1-5: --stdin-json has real behaviour", () => {
  async function runStdinJson(
    content: string | Buffer[],
  ): Promise<{ r: { ok: boolean; exitCode: number }; out: string; err: string }> {
    const out = sink();
    const err = sink();
    const chunks = Array.isArray(content) ? content : [Buffer.from(content, "utf8")];
    const r = await main([], {
      stdinJson: true,
      stdout: out,
      stderr: err,
      stdin: { isTTY: false },
      stdinStream: Readable.from(chunks),
    });
    return { r, out: out.text(), err: err.text() };
  }

  it("reads the command from piped JSON and prints the server-rendered page", async () => {
    const { r, out, err } = await runStdinJson('{"cmd":"groups list"}');
    expect(r, err).toEqual({ ok: true, exitCode: 0 });
    expect(out).toContain("name");
  });

  it("accepts {command} as an alias for {cmd}", async () => {
    const { r, out } = await runStdinJson('{"command":"groups list"}');
    expect(r.exitCode).toBe(0);
    expect(out).toContain("name");
  });

  it("handles a frame split across several stdin chunks", async () => {
    const { r, out, err } = await runStdinJson([Buffer.from('{"cmd":"gro'), Buffer.from('ups list"}')]);
    expect(r.exitCode, err).toBe(0);
    expect(out).toContain("name");
  });

  it("exits 1 with a clear message on malformed piped JSON", async () => {
    const { r, err, out } = await runStdinJson("{not json");
    expect(r).toEqual({ ok: false, exitCode: 1 });
    expect(err).toContain("--stdin-json expects a JSON request frame");
    expect(out).toBe("");
  });

  it("exits 1 when the piped frame carries no command", async () => {
    const { r, err } = await runStdinJson("{}");
    expect(r.exitCode).toBe(1);
    expect(err).toContain("--stdin-json expects a JSON request frame");
  });

  it("exits 1 on empty piped input", async () => {
    const { r, err } = await runStdinJson("");
    expect(r.exitCode).toBe(1);
    expect(err).toContain("--stdin-json expects a JSON request frame");
  });

  it("propagates a host-side failure through the pipe with exit code 1, printed once", async () => {
    const { r, err, out } = await runStdinJson('{"cmd":"groups get"}');
    expect(r).toEqual({ ok: false, exitCode: 1 });
    expect(out).toBe("");
    expect(err).toContain("missing id");
    expect(err.match(/missing id/g)?.length).toBe(1);
  });

  it("combines with --json to emit machine structure with no human field", async () => {
    const out = sink();
    const r = await main([], {
      stdinJson: true,
      json: true,
      stdout: out,
      stderr: sink(),
      stdin: { isTTY: false },
      stdinStream: Readable.from([Buffer.from('{"cmd":"groups list"}')]),
    });
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(out.text()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("human");
    expect(parsed.ok).toBe(true);
  });

  it("honours a caller-supplied requestId from the piped frame", async () => {
    const out = sink();
    const r = await main([], {
      stdinJson: true,
      json: true,
      stdout: out,
      stderr: sink(),
      stdin: { isTTY: false },
      stdinStream: Readable.from([Buffer.from('{"cmd":"groups list","requestId":"fixed-123"}')]),
    });
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(out.text()) as { requestId?: string }).requestId).toBe("fixed-123");
  });
});

/*
 * Modification record:
 *   2026-10-06  Created (P0-4 / P1-5)
 */
