/**
 * cli/transport-errors.ts -- actionable messages when the client cannot reach the host.
 *
 * Responsibility: turn a raw socket error into "the host is not running, here is how
 * to start it" instead of leaking `Error: connect ENOENT \\.\pipe\oc-ctl-...`.
 *
 * Key exports: formatTransportError, isUnreachableCode, UNREACHABLE_CODES
 * Invariant: pure string formatting -- no I/O, no process exit, so it is unit-testable.
 *
 * Why EPERM/EACCES count as unreachable: on Windows the control socket is a named
 * pipe. A pipe that exists but is not being served (host died mid-startup, or is
 * owned by another user/session) surfaces as EPERM or EACCES rather than ENOENT,
 * and the operator's remedy is identical -- start the host.
 *
 * Referenced: nanoclaw src/cli/transport-errors.ts
 *
 * Modification record:
 *   2026-10-04  Created (P0-4: transport error formatting)
 *   2026-10-06  P0-5: EPERM/EACCES treated as unreachable; codes extracted for testability
 */
import { INSTALL_SLUG } from "../config.js";

/** Socket error codes that mean "no host is listening", across unix socket and win32 pipe. */
export const UNREACHABLE_CODES = ["ENOENT", "ECONNREFUSED", "EPERM", "EACCES"] as const;

export function isUnreachableCode(message: string): boolean {
  return UNREACHABLE_CODES.some((code) => message.includes(code));
}

export function formatTransportError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (!isUnreachableCode(msg)) {
    return `oc: transport error: ${msg}\n`;
  }
  const lines = [
    `oc: cannot reach the OC host (${msg}).`,
    `Is the host running? Start it with:`,
    `  pnpm dev        # foreground, logs to the terminal`,
    `  pnpm start      # same entry, no watch`,
  ];
  if (INSTALL_SLUG) lines.push(`(install slug: ${INSTALL_SLUG})`);
  return lines.join("\n") + "\n";
}

/*
 * Modification record:
 *   2026-10-04  Created (P0-4: transport error formatting)
 *   2026-10-06  P0-5: EPERM/EACCES coverage + exported predicate for unit tests
 */
