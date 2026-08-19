/**
 * container-runner.test.ts ?”â€?å®¹å™¨è¿è??¨é??æ?è¯•ï?æ³¨å…¥ spawnerï¼Œä??Ÿèµ· Dockerï¼? *
 * ?Œè´£ï¼šwakeContainer ?»é?/æ°¸ä????€?ºæ??†ï?killContainer onExit ?¥å?ï¼›restart on_wake è¯­ä?ï¼? *       buildMounts é¡ºå?ä¸?RO åµŒå?ï¼›buildContainerArgs å¼ºå?ä¸è?æºé??¶ã€? * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?3ï¼? */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createAgentGroup, createSession, initTestDb, runMigrations } from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";
import {
  buildContainerArgs,
  buildMounts,
  getActiveContainerCount,
  hardeningArgs,
  isContainerRunning,
  killContainer,
  resetContainerSpawnerForTest,
  setContainerSpawnerForTest,
  wakeContainer,
} from "../../src/container-runner.js";
import { containerNameFor } from "../../src/container-runner.js";
import { configFromDb } from "../../src/container-config.js";
import { restartAgentGroupContainers } from "../../src/container-restart.js";
import { withInboundDb } from "../../src/db/session-db.js";
import { inboundDbPath } from "../../src/session-manager.js";
import type { ChildProcess } from "node:child_process";
import type { Session } from "../../src/types.js";

class FakeProc extends EventEmitter {
  stderr = new EventEmitter();
  stdout = new EventEmitter();
  killed = false;
}

let spawned: Array<{ args: string[] }> = [];
let procs: FakeProc[] = [];

function installFakeSpawner() {
  setContainerSpawnerForTest((_bin, args) => {
    const p = new FakeProc();
    spawned.push({ args });
    procs.push(p);
    return p as unknown as ChildProcess;
  });
}

let session: Session;

beforeEach(() => {
  runMigrations(initTestDb(), [migration001]);
  const group = createAgentGroup({ name: "CR", folder: `cr-${Math.random().toString(36).slice(2, 8)}` });
  session = createSession({ agentGroupId: group.id });
  spawned = [];
  procs = [];
  installFakeSpawner();
});

afterEach(() => {
  resetContainerSpawnerForTest();
  closeDb();
});

describe("container-runner", () => {
  it("wakeContainer spawns once and dedups in-flight + active", async () => {
    const p1 = wakeContainer(session);
    const p2 = wakeContainer(session); // in-flight ?»é?
    await Promise.all([p1, p2]);
    expect(spawned).toHaveLength(1);
    expect(isContainerRunning(session.id)).toBe(true);
    await wakeContainer(session); // active ?»é?
    expect(spawned).toHaveLength(1);
    expect(getActiveContainerCount()).toBe(1);
  });

  it("wakeContainer never throws on spawner error (returns false)", async () => {
    setContainerSpawnerForTest(() => {
      throw new Error("docker missing");
    });
    await expect(wakeContainer(session)).resolves.toBe(false);
  });

  it("exit cleans registry and marks stopped; args carry hardening + limits + entrypoint exec", async () => {
    await wakeContainer(session);
    const args = spawned[0]!.args;
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--security-opt=no-new-privileges");
    expect(args).toContain("--init");
    expect(args.join(" ")).toContain("exec bun run /app/src/index.ts");
    expect(args).toContain("--label");
    procs[0]!.emit("close", 0, null);
    expect(isContainerRunning(session.id)).toBe(false);
    expect(getActiveContainerCount()).toBe(0);
  });

  it("killContainer fires onExit after process exit (relay for restart)", async () => {
    await wakeContainer(session);
    let relayed = false;
    killContainer(session, { onExit: () => void (relayed = true) });
    expect(relayed).toBe(false); // è¿›ç??ªé€€?ºä?è§¦å?
    procs[0]!.emit("close", null, "SIGTERM");
    expect(relayed).toBe(true);
  });

  it("buildMounts orders workspace first with RO nested container.json", () => {
    const config = configFromDb(session.agent_group_id);
    const mounts = buildMounts(session, config, { mounts: [], env: {} });
    expect(mounts[0]!.container).toBe("/workspace");
    const cj = mounts.find((m) => m.container === "/workspace/agent/container.json");
    expect(cj?.readonly).toBe(true);
    const inbound = mounts.find((m) => m.container === "/workspace/inbound.db");
    expect(inbound?.readonly).toBe(true);
  });

  it("hardeningArgs is the fixed triple", () => {
    expect(hardeningArgs()).toEqual(["--cap-drop=ALL", "--security-opt=no-new-privileges", "--init"]);
  });

  it("restart writes on_wake message and respawns via onExit", async () => {
    await wakeContainer(session);
    const first = procs[0]!;
    const n = restartAgentGroupContainers(session.agent_group_id, "test", "config changed; restart");
    expect(n).toBe(1);
    first.emit("close", null, "SIGTERM"); // ?§å®¹?¨æ­»????onExit ?¤é?
    await new Promise((r) => setTimeout(r, 10));
    expect(spawned).toHaveLength(2);
    const rows = withInboundDb(inboundDbPath(session.agent_group_id, session.id), (db) =>
      db.prepare("SELECT on_wake, content FROM messages_in").all(),
    ) as Array<{ on_wake: number; content: string }>;
    expect(rows.some((r) => r.on_wake === 1 && r.content.includes("restart"))).toBe(true);
  });

  it("containerNameFor yields label-safe names", () => {
    expect(containerNameFor(session)).toMatch(/^OC-[0-9a-f]{8}-\d+$/);
  });
});

describe("buildContainerArgs secret injection (fix-plan P1)", () => {
  const baseCfg = {
    provider: "openai",
    assistantName: null,
    model: null,
    effort: null,
    mcpServers: {},
    packages: [],
    mounts: [],
    cliScope: "group" as const,
    timezone: null,
    cpuLimit: null,
    memoryLimit: null,
    pidsLimit: null,
  };

  it("uses --env-file when envFilePath provided; key not in argv", () => {
    const args = buildContainerArgs([], "c1", baseCfg, { OPENAI_API_KEY: "sk-secret" }, "/tmp/env-c1");
    expect(args).toContain("--env-file");
    expect(args[args.indexOf("--env-file") + 1]).toBe("/tmp/env-c1");
    // å¯†é’¥ä¸å?ä»?-e KEY=VALUE å½¢å??ºç°??argv
    expect(args.some((a) => a.includes("sk-secret"))).toBe(false);
    expect(args).not.toContain("-e");
  });

  it("falls back to -e when no envFilePath (no-secret/test path)", () => {
    const args = buildContainerArgs([], "c1", baseCfg, { FOO: "bar" }, null);
    expect(args).toContain("-e");
    expect(args).toContain("FOO=bar");
    expect(args).not.toContain("--env-file");
  });
});
