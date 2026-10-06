/**
 * cli/parse-argv.ts -- argv parsing for the oc client.
 *
 * Responsibility: split client-only flags (--json / --stdin-json) from the wire
 * command string. Everything else passes through verbatim so the host's
 * dispatch.parseCmd does the real resource/verb/flag parsing -- one parser, not two.
 *
 * Key exports: parseArgv, ParsedArgv, CLIENT_ONLY_FLAGS
 * Invariant: the wire `cmd` is SPACE-joined (OC's dispatch splits on /\s+/).
 *   Do not "fix" this to dash-join: nanoclaw's registry keys commands by dashed
 *   name ("groups-list"), OC keys them by "<resource> <verb>". Copying nanoclaw's
 *   parse-argv shape here would produce commands the OC registry can never match.
 *
 * Referenced: nanoclaw src/cli/parse-argv.ts (flag-stripping shape only)
 *
 * Modification record:
 *   2026-10-04  Created (P2-14: CLI file splitting)
 *   2026-10-06  P1-5/P2-1: rewritten to OC's space-joined wire format and actually
 *               wired into client.ts (was dead code with a nanoclaw-shaped dash join)
 */

/** Flags consumed by the client itself and never forwarded to the host. */
export const CLIENT_ONLY_FLAGS = ["--json", "--stdin-json"] as const;

export interface ParsedArgv {
  /** Wire command string, e.g. "groups create --name G --folder g". */
  cmd: string;
  /** Emit the raw response frame as JSON instead of the server-rendered `human`. */
  json: boolean;
  /** Read the request frame from stdin instead of argv. */
  stdinJson: boolean;
  /** Positional/flag tokens after client-only flags were stripped. */
  tokens: string[];
}

export function parseArgv(argv: string[]): ParsedArgv {
  let json = false;
  let stdinJson = false;
  const tokens: string[] = [];

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--stdin-json") {
      stdinJson = true;
      continue;
    }
    tokens.push(arg);
  }

  return { cmd: tokens.join(" "), json, stdinJson, tokens };
}

/*
 * Modification record:
 *   2026-10-04  Created (P2-14: CLI file splitting)
 *   2026-10-06  P1-5/P2-1: space-joined wire format; wired into client.ts
 */
