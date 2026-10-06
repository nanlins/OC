/**
 * scheduling/task-script.test.ts —— pre-task 脚本门控测试（bun:test）
 *
 * 职责：决策逻辑（wakeAgent/data / wakeAgent=false / 坏 JSON / 无输出 / 错误退出 /
 *       输出超限 / 超时）经注入的 fake spawn 确定性单测；信封解析（JSON + 纯字符串兼容）；
 *       外加一个真实 bash 用例（宿主机有 bash 时跑，否则显式跳过）。
 *
 * 修改记录：2026-10-06 创建（P0-3）
 */
import { describe, expect, it } from "bun:test";
import { parseTaskEnvelope, runTaskScriptGate, type ScriptProcess, type ScriptSpawn } from "./task-script.ts";

/** 从字符串构造可读流。 */
function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** 可控 fake 进程。 */
function fakeProcess(opts: { stdout?: string; stderr?: string; exitCode?: number; neverExit?: boolean }): ScriptProcess {
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((r) => {
    resolveExit = r;
  });
  if (!opts.neverExit) {
    queueMicrotask(() => resolveExit(opts.exitCode ?? 0));
  }
  return {
    pid: 42_000 + Math.floor(Math.random() * 1000),
    stdout: streamOf(opts.stdout ?? ""),
    stderr: streamOf(opts.stderr ?? ""),
    exited,
  };
}

const spawnReturning =
  (opts: { stdout?: string; stderr?: string; exitCode?: number; neverExit?: boolean }): ScriptSpawn =>
  () =>
    fakeProcess(opts);

/** fake spawn 的固定配套：killGroup 注入 no-op（单测不得真的 spawn bash——那会阻塞 bun 测试）。 */
const FAKE_OPTS = { killGroup: () => {} };

describe("parseTaskEnvelope", () => {
  it("parses the JSON envelope", () => {
    const env = parseTaskEnvelope(JSON.stringify({ prompt: "p", script: "true", originSessionId: "s1" }));
    expect(env).toEqual({ prompt: "p", script: "true", originSessionId: "s1" });
  });

  it("falls back to plain-string legacy tasks", () => {
    const env = parseTaskEnvelope("just a prompt");
    expect(env).toEqual({ prompt: "just a prompt", script: null, originSessionId: null });
  });

  it("treats malformed JSON as a plain string (never loses the task)", () => {
    const env = parseTaskEnvelope("{not json");
    expect(env.prompt).toBe("{not json");
    expect(env.script).toBeNull();
  });

  it("rejects non-envelope objects (unknown keys) and falls back to the raw string", () => {
    const env = parseTaskEnvelope(JSON.stringify({ type: "other", x: 1 }));
    expect(env.script).toBeNull();
  });
});

describe("runTaskScriptGate (injected fake spawn)", () => {
  it("wakeAgent=true wakes and carries data", async () => {
    const res = await runTaskScriptGate("fake", {
      spawnScript: spawnReturning({ stdout: '{"wakeAgent":true,"data":"hello-data"}' }),
      ...FAKE_OPTS,
    });
    expect(res.decision).toBe("wake");
    expect(res.data).toBe("hello-data");
  });

  it("wakeAgent=true with object data serializes data", async () => {
    const res = await runTaskScriptGate("fake", {
      spawnScript: spawnReturning({ stdout: '{"wakeAgent":true,"data":{"n":1}}' }),
      ...FAKE_OPTS,
    });
    expect(res.decision).toBe("wake");
    expect(res.data).toBe('{"n":1}');
  });

  it("wakeAgent=false is script-skip", async () => {
    const res = await runTaskScriptGate("fake", {
      spawnScript: spawnReturning({ stdout: '{"wakeAgent":false}' }),
      ...FAKE_OPTS,
    });
    expect(res.decision).toBe("skip");
    expect(res.reason).toContain("wakeAgent");
  });

  it("bad JSON output is script-skip", async () => {
    const res = await runTaskScriptGate("fake", {
      spawnScript: spawnReturning({ stdout: "not-json" }),
      ...FAKE_OPTS,
    });
    expect(res.decision).toBe("skip");
    expect(res.reason).toContain("not valid JSON");
  });

  it("non-object JSON (array) is script-skip", async () => {
    const res = await runTaskScriptGate("fake", {
      spawnScript: spawnReturning({ stdout: "[1,2]" }),
      ...FAKE_OPTS,
    });
    expect(res.decision).toBe("skip");
  });

  it("no output is script-skip", async () => {
    const res = await runTaskScriptGate("fake", {
      spawnScript: spawnReturning({ stdout: "" }),
      ...FAKE_OPTS,
    });
    expect(res.decision).toBe("skip");
    expect(res.reason).toContain("no output");
  });

  it("non-zero exit is script-skip", async () => {
    const res = await runTaskScriptGate("fake", {
      spawnScript: spawnReturning({ stdout: '{"wakeAgent":true}', stderr: "boom", exitCode: 3 }),
      ...FAKE_OPTS,
    });
    expect(res.decision).toBe("skip");
    expect(res.reason).toContain("exited 3");
  });

  it("output over limit is script-skip", async () => {
    const res = await runTaskScriptGate("fake", {
      spawnScript: spawnReturning({ stdout: "a".repeat(5000) }),
      maxOutputBytes: 1000,
      ...FAKE_OPTS,
    });
    expect(res.decision).toBe("skip");
    expect(res.reason).toContain("output exceeded");
  });

  it("timeout resolves promptly without waiting for the process to die", async () => {
    const t0 = Date.now();
    const res = await runTaskScriptGate("fake", {
      spawnScript: spawnReturning({ neverExit: true }),
      timeoutMs: 200,
      killGraceMs: 50,
      ...FAKE_OPTS,
    });
    const elapsed = Date.now() - t0;
    expect(res.decision).toBe("skip");
    expect(res.reason).toContain("timeout");
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("runTaskScriptGate (real bash, skipped when unavailable)", () => {
  const bashAvailable = (() => {
    try {
      Bun.spawnSync(["bash", "--version"], { stdout: "ignore", stderr: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!bashAvailable)(
    "runs a real bash script end to end",
    async () => {
      const res = await runTaskScriptGate(`echo '{"wakeAgent":true,"data":"real-bash"}'`, { timeoutMs: 20_000 });
      expect(res.decision).toBe("wake");
      expect(res.data).toBe("real-bash");
    },
    { timeout: 30_000 },
  );
});
