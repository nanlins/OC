/**
 * deepseek-live.test.ts -- real spawn -> message -> LLM reply end-to-end (T1-2).
 *
 * Responsibility: drive the actual product path with a real upstream model, not a mock:
 *   host process (src/index.ts) -> CLI chat socket -> router -> messages_in (inbound.db)
 *   -> real Docker container spawn -> agent-runner poll-loop -> provider
 *   -> host LLM proxy (injects the key) -> real DeepSeek -> messages_out (outbound.db)
 *   -> delivery poll -> chat socket -> assertion on the reply text.
 *
 * Preconditions (all reported as an explicit skip reason, never a vacuous pass):
 *   - OC_E2E=1
 *   - a credential in the environment (OPENAI_API_KEY). This file never contains,
 *     prints, or snapshots a key; if you need one, export it in your shell.
 *   - a reachable Docker daemon and a built agent image (pnpm build:container)
 *
 * Why the host runs as a subprocess: this is an end-to-end test of the shipped entry
 * point. Driving the modules in-process would test the wiring we wrote here rather than
 * the wiring the product actually uses, and would bind the CLI named pipe inside the
 * vitest worker (which previously took the fork down).
 *
 * Modification record:
 *   2026-10-06  Created (T1-2: real DeepSeek E2E, replacing the vacuous docker probe)
 */
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect } from "node:net";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROJECT_ROOT, INSTALL_SLUG, CONTAINER_IMAGE } from "../../src/config.js";

const MODEL = process.env.OC_E2E_MODEL || "deepseek-flash";
const PROXY_PORT = process.env.OC_E2E_PROXY_PORT || "18081";
const HOST_BOOT_TIMEOUT_MS = 60_000;
const REPLY_TIMEOUT_MS = Number(process.env.OC_E2E_REPLY_TIMEOUT_MS ?? 180_000);

function dockerAvailable(): boolean {
  try {
    // A wedged daemon must not hang the suite, hence the explicit timeout. `docker info`
    // only talks to the daemon; unlike `docker ps -a` / `logs` / `inspect` it does not
    // block on per-container state when a containerd shim lock is stuck.
    execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore", timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

const hasCredential = Boolean(process.env.OPENAI_API_KEY);
const hasDocker = dockerAvailable();
const e2eEnabled = process.env.OC_E2E === "1";
const skipReason = !e2eEnabled
  ? "OC_E2E=1 not set"
  : !hasCredential
    ? "OPENAI_API_KEY not set in the environment (this test never reads .env or hardcodes a key)"
    : !hasDocker
      ? "docker daemon unreachable"
      : "";

// A scratch install so the run cannot touch the developer's real data/ or groups/.
// Kept under the repo's gitignored data/ dir so Docker Desktop can bind-mount it.
const scratchRoot = join(PROJECT_ROOT, "data", `e2e-live-${process.pid}`);
const dataDir = join(scratchRoot, "data");
const groupsDir = join(scratchRoot, "groups");
const chatPipe = `\\\\.\\pipe\\oc-chat-${INSTALL_SLUG}`;

let host: ChildProcessWithoutNullStreams | null = null;
let hostLog = "";

function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - t0 > timeoutMs)
        return reject(new Error(`timed out waiting for ${what}\n--- host log ---\n${hostLog.slice(-4000)}`));
      setTimeout(tick, 250);
    };
    tick();
  });
}

/** Send one message over the CLI chat socket and collect frames until `end`. */
function sendAndCollect(text: string, timeoutMs: number): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const frames: Array<Record<string, unknown>> = [];
    const socket = connect(chatPipe);
    let buf = "";
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      fn();
    };
    const timer = setTimeout(
      () =>
        done(() => reject(new Error(`no reply within ${timeoutMs}ms; frames=${JSON.stringify(frames).slice(0, 800)}`))),
      timeoutMs,
    );
    socket.on("connect", () => {
      socket.write(JSON.stringify({ text }) + "\n");
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const f = JSON.parse(line) as Record<string, unknown>;
          frames.push(f);
          if (f.kind === "end") {
            // Small grace window so a trailing frame is not lost.
            setTimeout(() => done(() => resolve(frames)), 1200);
            return;
          }
        } catch {
          /* non-JSON line: ignore, do not abort the conversation */
        }
      }
    });
    socket.on("error", (e) => done(() => reject(new Error(`chat socket error: ${e.message}`))));
  });
}

describe.skipIf(Boolean(skipReason))("T1-2 live DeepSeek end-to-end", () => {
  beforeAll(async () => {
    rmSync(scratchRoot, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(groupsDir, { recursive: true });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OC_DATA_DIR: dataDir,
      OC_GROUPS_DIR: groupsDir,
      OC_LLM_PROXY_PORT: PROXY_PORT,
      OC_LLM_PROXY_HOST: "127.0.0.1",
      DEFAULT_AGENT_PROVIDER: "openai",
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "https://api.deepseek.com/v1",
      // Anthropic profile uses the same DeepSeek key; the host proxy needs both creds so
      // the /llm-proxy-anthropic profile can forward to api.deepseek.com/anthropic.
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || "",
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || "https://api.deepseek.com/anthropic",
      LOG_LEVEL: "info",
    };
    // src/index.ts guards its entry with `process.env.VITEST !== "true"` so that merely
    // importing it in a unit test cannot boot a host. The children below ARE real host
    // processes, not tests, so the vitest markers must be stripped or the child imports
    // everything and never calls main() -- which shows up as an empty log and a timeout.
    for (const k of ["VITEST", "VITEST_POOL_ID", "VITEST_WORKER_ID", "VITEST_MODE", "TEST_MODE"]) {
      delete env[k];
    }

    // Bootstrap the install exactly the way an operator would: demo-setup creates the
    // agent group AND wires the CLI channel (T2). Running it as a subprocess keeps the
    // central DB out of this process's better-sqlite3 handle.
    const setup = spawn(
      process.execPath,
      [join("node_modules", "tsx", "dist", "cli.mjs"), join("scripts", "demo-setup.ts")],
      {
        cwd: PROJECT_ROOT,
        env,
      },
    );
    let setupOut = "";
    setup.stdout.on("data", (c: Buffer) => {
      setupOut += c.toString();
    });
    setup.stderr.on("data", (c: Buffer) => {
      setupOut += c.toString();
    });
    const setupCode = await new Promise<number | null>((r) => setup.on("close", r));
    expect(setupCode, `demo-setup failed:\n${setupOut}`).toBe(0);
    expect(setupOut).toContain("instance=cli");

    // Point the demo group at the model under test.
    const groupId = /agent group: ([0-9a-f-]{36})/.exec(setupOut)?.[1];
    expect(groupId, `could not parse agent group id from:\n${setupOut}`).toBeTruthy();
    const setModel = spawn(
      process.execPath,
      [
        join("node_modules", "tsx", "dist", "cli.mjs"),
        join("scripts", "set-group-model.ts"),
        groupId!,
        "openai",
        MODEL,
      ],
      { cwd: PROJECT_ROOT, env },
    );
    await new Promise<number | null>((r) => setModel.on("close", r));

    host = spawn(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), join("src", "index.ts")], {
      cwd: PROJECT_ROOT,
      env,
    });
    host.stdout.on("data", (c: Buffer) => {
      hostLog += c.toString();
    });
    host.stderr.on("data", (c: Buffer) => {
      hostLog += c.toString();
    });
    // Diagnostics: an instantly-exiting or unspawnable host would otherwise surface only
    // as an empty log and a timeout, which tells you nothing.
    host.on("error", (e) => {
      hostLog += `\n[spawn error] ${e.message}\n`;
    });
    host.on("exit", (code, signal) => {
      hostLog += `\n[host exited early] code=${code} signal=${signal}\n`;
    });
    await waitFor(() => hostLog.includes("oc host started"), HOST_BOOT_TIMEOUT_MS, "host startup");
    await waitFor(() => hostLog.includes("llm proxy listening"), HOST_BOOT_TIMEOUT_MS, "llm proxy bind");
    // The proxy must have bound the port we asked for, not silently fallen back.
    expect(hostLog).toContain(`127.0.0.1:${PROXY_PORT}`);
    expect(hostLog).not.toContain("EADDRINUSE");
  }, 180_000);

  afterAll(() => {
    if (host && !host.killed) host.kill("SIGKILL");
    host = null;
    // Best effort: the scratch install lives under gitignored data/.
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  it(
    "a real Chinese message comes back as a non-empty reply from the configured model",
    async () => {
      const frames = await sendAndCollect(
        "\u8bf7\u7528\u4e00\u53e5\u4e2d\u6587\u56de\u7b54\uff1a1+1 \u7b49\u4e8e\u51e0\uff1f",
        REPLY_TIMEOUT_MS,
      );

      const meta = frames.find((f) => f.kind === "meta");
      const chat = frames.find((f) => f.kind === "chat");
      const end = frames.find((f) => f.kind === "end");

      expect(end, `no end frame in ${JSON.stringify(frames).slice(0, 600)}`).toBeDefined();
      expect(meta, "no meta frame").toBeDefined();
      expect(meta?.model).toBe(MODEL);

      // The core assertion: a real, non-empty natural-language reply.
      expect(chat, "no chat frame").toBeDefined();
      const text = String(chat?.text ?? "");
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text.length).toBeLessThan(20_000);

      // The reply must be the model's own words, not an error payload surfaced as chat.
      expect(hostLog).not.toContain("llm proxy upstream failed");
      expect(hostLog).not.toContain("rejected untrusted peer");
      expect(text).not.toMatch(/Authentication Fails|InvalidAuthentication|401/i);
    },
    REPLY_TIMEOUT_MS + 30_000,
  );

  it("the container really ran: it wrote odd-seq outbound rows and an ack", async () => {
    // Read the session's outbound.db directly. Odd seq = container-written (the host
    // only ever writes even seq), so this proves a container produced the reply rather
    // than the host echoing something.
    const storeRoot = join(dataDir, "v2-sessions");
    const groupDirs = existsSync(storeRoot) ? readdirSync(storeRoot) : [];
    expect(groupDirs.length).toBeGreaterThan(0);
    let checked = 0;
    for (const g of groupDirs) {
      const gdir = join(storeRoot, g);
      for (const s of readdirSync(gdir)) {
        const outP = join(gdir, s, "outbound.db");
        if (!existsSync(outP)) continue;
        const db = new Database(outP, { readonly: true });
        try {
          const rows = db
            .prepare("SELECT seq, kind, length(content) AS len FROM messages_out ORDER BY seq")
            .all() as Array<{
            seq: number;
            kind: string;
            len: number;
          }>;
          expect(rows.length).toBeGreaterThan(0);
          for (const r of rows) {
            expect(r.seq % 2, `container must write odd seq, got ${r.seq}`).toBe(1);
            expect(r.kind).toBe("chat");
            expect(r.len).toBeGreaterThan(0);
          }
          const acks = db.prepare("SELECT status FROM processing_ack").all() as Array<{ status: string }>;
          expect(acks.some((a) => a.status === "completed")).toBe(true);
          const state = db.prepare("SELECT key FROM session_state").all() as Array<{ key: string }>;
          expect(state.some((r) => r.key.startsWith("history:"))).toBe(true);
          checked += 1;
        } finally {
          db.close();
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 60_000);

  it(
    "both upstream profiles return real text through the proxy (openai + anthropic)",
    async () => {
      // A second container, pointed straight at the host proxy, sends a FAKE key on both
      // profiles. A 200 + non-empty body proves (a) the proxy strips the container's
      // credential and injects the host key, and (b) both upstream endpoints
      // (api.deepseek.com/v1 and api.deepseek.com/anthropic) answer with real text.
      const probe = [
        'const BASE = "http://host.docker.internal:' + PROXY_PORT + '";',
        'const FAKE = "fake-container-key";',
        'const MODEL = "deepseek-flash";',
        "async function openai() {",
        '  const r = await fetch(BASE + "/llm-proxy/chat/completions", {',
        '    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + FAKE },',
        '    body: JSON.stringify({ model: MODEL, max_tokens: 2048, messages: [{ role: "user", content: "\\u8bf7\\u56de\\u7b54\\uff1a1+1\\u7b49\\u4e8e\\u51e0\\uff1f" }] }),',
        "  });",
        "  const j = await r.json();",
        "  return { status: r.status, model: j.model, finish: j.choices?.[0]?.finish_reason, text: j.choices?.[0]?.message?.content ?? '' };",
        "}",
        "async function anthropic() {",
        '  const r = await fetch(BASE + "/llm-proxy-anthropic/v1/messages", {',
        '    method: "POST", headers: { "content-type": "application/json", "x-api-key": FAKE, "anthropic-version": "2023-06-01" },',
        '    body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: "user", content: "\\u8bf7\\u56de\\u7b54\\uff1a\\u6c34\\u7684\\u5316\\u5b66\\u5f0f\\uff1f" }] }),',
        "  });",
        "  const j = await r.json();",
        "  const text = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');",
        "  return { status: r.status, model: j.model, stop: j.stop_reason, text };",
        "}",
        "const out = { openai: await openai(), anthropic: await anthropic() };",
        'console.log("PROBE_RESULT_B64:" + Buffer.from(JSON.stringify(out), "utf8").toString("base64"));',
      ].join("\n");
      writeFileSync(join(scratchRoot, "proxy-probe.mjs"), probe, "utf8");

      const mount = `${scratchRoot.replace(/\\/g, "/")}:/probe`;
      const raw = execFileSync(
        "docker",
        ["run", "--rm", "-v", mount, "--entrypoint", "bun", CONTAINER_IMAGE, "/probe/proxy-probe.mjs"],
        { encoding: "utf8", timeout: 180_000, cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"] },
      );

      const b64 = /PROBE_RESULT_B64:([A-Za-z0-9+/=]+)/.exec(raw)?.[1];
      expect(b64, `no probe marker in container output:\n${raw.slice(0, 800)}`).toBeTruthy();
      const result = JSON.parse(Buffer.from(b64!, "base64").toString("utf8")) as {
        openai: { status: number; model: string; finish: string | null; text: string };
        anthropic: { status: number; model: string; stop: string | null; text: string };
      };

      expect(result.openai.status).toBe(200);
      expect(result.openai.model).toBe("deepseek-flash");
      expect(result.openai.finish).toBe("stop");
      expect(result.openai.text.trim().length).toBeGreaterThan(0);

      expect(result.anthropic.status).toBe(200);
      expect(result.anthropic.model).toBe("deepseek-flash");
      expect(result.anthropic.stop).toBe("end_turn");
      expect(result.anthropic.text.trim().length).toBeGreaterThan(0);
    },
    REPLY_TIMEOUT_MS + 30_000,
  );
});

describe("T1-2 preconditions", () => {
  it.skipIf(!skipReason)("are unmet, so the live suite is skipped", () => {
    expect(skipReason).not.toBe("");
  });
});

/*
 * Modification record:
 *   2026-10-06  Created (T1-2)
 */
