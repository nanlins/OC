/**
 * cli/client.ts -- oc command-line client
 *
 * Responsibility: argv (or --stdin-json) -> wire frame -> control socket -> print
 * the server-rendered `human` (or the raw frame with --json) exactly once.
 *
 * Key exports: main, ClientOptions, ClientResult, stripHuman
 * Usage: pnpm oc -- groups list / pnpm oc -- approvals resolve <id> --decision approve
 *
 * Invariants:
 *   - Every failure path prints ONCE. `main` owns all output and returns an exit
 *     code; the entry point must not reprint what main already wrote (P0-4: the
 *     old shape printed the server error in the data handler and then again from
 *     the outer .catch, so every failure showed up twice).
 *   - A malformed response frame is a client-side error with its own message, not
 *     an uncaught throw from inside a 'data' listener.
 *   - --json emits machine structure only: `human` is stripped so scripts never
 *     have to distinguish the two renderings.
 *   - Secrets never appear here: the client only carries the command string.
 *
 * Modification record:
 *   2026-08-12  Created (phase 7)
 *   2026-08-13  Phase 14: client transport errors wired to i18n
 *   2026-10-04  P0-4: transport error formatting; P2-12: UUID requestId, --json, --stdin-json
 *   2026-10-06  P0-4: single-print contract (main returns an exit code, no rethrow);
 *               P1-5: --json strips `human`, --stdin-json really reads stdin;
 *               P2-1: argv parsing delegated to parse-argv.ts (was a duplicate inline loop)
 */
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { cliControlPath } from "./socket-server.js";
import type { ResponseFrame } from "./frame.js";
import { t, resolveLocaleFromEnv } from "../i18n/index.js";
import { formatTransportError } from "./transport-errors.js";
import { parseArgv } from "./parse-argv.js";

export interface ClientOptions {
  json?: boolean;
  stdinJson?: boolean;
  timeoutMs?: number;
  /** Command to send; when omitted it is taken from argv. */
  cmd?: string;
  /** Injectable streams so the client is unit-testable without spawning a process. */
  stdout?: { write: (s: string) => unknown };
  stderr?: { write: (s: string) => unknown };
  stdin?: { isTTY?: boolean | null };
  /** Injectable stdin byte source for --stdin-json; defaults to process.stdin. */
  stdinStream?: AsyncIterable<unknown>;
}

export interface ClientResult {
  ok: boolean;
  exitCode: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** --json output is machine structure only: drop the server-rendered presentation. */
export function stripHuman(res: ResponseFrame): Record<string, unknown> {
  const out: Record<string, unknown> = { ok: res.ok };
  if (res.requestId !== undefined) out.requestId = res.requestId;
  if (res.code !== undefined) out.code = res.code;
  if (res.error !== undefined) out.error = res.error;
  if (res.data !== undefined) out.data = res.data;
  return out;
}

async function readStdinAll(source: AsyncIterable<unknown> = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of source) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks).toString("utf8");
}

/** Parse a --stdin-json request frame. Accepts {cmd} (wire shape) or a bare JSON string. */
export function parseStdinFrame(raw: string): { cmd: string; requestId?: string } | null {
  const text = raw.trim();
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value === "string") return value.trim() ? { cmd: value.trim() } : null;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const cmd = rec.cmd ?? rec.command;
    if (typeof cmd !== "string" || !cmd.trim()) return null;
    const requestId = typeof rec.requestId === "string" ? rec.requestId : undefined;
    return { cmd: cmd.trim(), requestId };
  }
  return null;
}

export async function main(argv: string[], opts: ClientOptions = {}): Promise<ClientResult> {
  const out = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const stdin = opts.stdin ?? process.stdin;
  const locale = resolveLocaleFromEnv();
  const fail = (msg: string): ClientResult => {
    err.write(msg.endsWith("\n") ? msg : msg + "\n");
    return { ok: false, exitCode: 1 };
  };

  const parsed = parseArgv(argv);
  const asJson = opts.json ?? parsed.json;
  const useStdin = opts.stdinJson ?? parsed.stdinJson;

  // --stdin-json needs a pipe; refusing in a TTY stops the user from hanging on an
  // interactive prompt they did not ask for.
  if (useStdin && stdin.isTTY) {
    return fail("oc: --stdin-json requires piped input, not a terminal");
  }

  let cmd = opts.cmd ?? parsed.cmd;
  let requestId: string = randomUUID();

  if (useStdin) {
    let raw: string;
    try {
      raw = await readStdinAll(opts.stdinStream);
    } catch (e) {
      return fail(`oc: failed to read stdin: ${e instanceof Error ? e.message : String(e)}`);
    }
    const frame = parseStdinFrame(raw);
    if (!frame) {
      return fail('oc: --stdin-json expects a JSON request frame, e.g. {"cmd":"groups list"}');
    }
    cmd = frame.cmd;
    if (frame.requestId) requestId = frame.requestId;
  }

  if (!cmd.trim()) {
    return fail(`oc: no command given\n${t("cli.usage", locale)}`);
  }

  return new Promise<ClientResult>((resolve) => {
    let settled = false;
    const finish = (r: ClientResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(r);
    };

    const socket = connect(cliControlPath());
    const timer = setTimeout(() => {
      finish(fail(`oc: ${t("cli.timeout", locale)}`));
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let buf = "";
    socket.on("connect", () => {
      socket.write(JSON.stringify({ cmd, requestId }) + "\n");
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx < 0) return;
      let res: ResponseFrame;
      try {
        res = JSON.parse(buf.slice(0, idx)) as ResponseFrame;
      } catch {
        // P0-4: a malformed frame used to throw inside the 'data' listener
        // (uncaught). Report it as a client-side error instead.
        finish(fail("oc: malformed response frame from host (expected one line of JSON)"));
        return;
      }
      if (asJson) {
        out.write(JSON.stringify(stripHuman(res), null, 2) + "\n");
      } else if (res.human) {
        out.write(res.human + "\n");
      } else if (res.ok) {
        out.write(JSON.stringify(res.data ?? null, null, 2) + "\n");
      } else {
        err.write(`${res.error ?? t("cli.error", locale, { msg: "unknown" })}\n`);
      }
      // Printed exactly once above -- resolve with a code, never rethrow.
      finish(res.ok ? { ok: true, exitCode: 0 } : { ok: false, exitCode: 1 });
    });
    socket.on("error", (e) => {
      finish(fail(formatTransportError(e).replace(/\n$/, "")));
    });
  });
}

const entry = process.argv[1] ? basename(process.argv[1]) : "";
if (entry === "client.ts" || entry === "client.js") {
  main(process.argv.slice(2))
    .then((r) => process.exit(r.exitCode))
    .catch((e) => {
      // Only genuinely unexpected throws reach here; every anticipated failure
      // already printed once inside main.
      process.stderr.write(`oc: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      process.exit(1);
    });
}

/*
 * Modification record:
 *   2026-10-04 P0-4: transport error formatting via transport-errors.ts
 *              P2-12: UUID requestId generation, --json / --stdin-json flags
 *   2026-10-06 P0-4: single-print contract; P1-5: --json strips human, --stdin-json implemented;
 *              P2-1: argv parsing via parse-argv.ts
 */
