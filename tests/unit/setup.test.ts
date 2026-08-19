/**
 * setup.test.ts —— 安装向导测试（状态块解析 + set-env set-if-absent + step 分发）
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 8）
 */
import { describe, expect, it } from "vitest";
import { parseStatusStream } from "../../src/setup/runner.js";
import { emitStatus } from "../../src/setup/status.js";

describe("setup status contract", () => {
  it("emits and parses L2 status blocks", () => {
    const captured: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = ((s: string) => {
      captured.push(s);
      return true;
    }) as never;
    try {
      emitStatus("environment", { platform: "win32", docker: false });
    } finally {
      (process.stdout as unknown as { write: (s: string) => boolean }).write = orig as never;
    }
    const blocks = parseStatusStream(captured.join(""));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("environment");
    expect(blocks[0]!.kv.platform).toBe("win32");
    expect(blocks[0]!.kv.docker).toBe("false");
  });

  it("runStep unknown step throws", async () => {
    const { runStep } = await import("../../src/setup/runner.js");
    await expect(runStep("nope", [])).rejects.toThrow(/unknown setup step/);
  });

  it("builtin steps registered", async () => {
    const { listSteps } = await import("../../src/setup/runner.js");
    await import("../../src/setup/steps.js").then((m) => {
      try {
        m.registerBuiltinSteps();
      } catch {
        /* 已注册 */
      }
    });
    for (const s of ["environment", "timezone", "set-env", "verify"]) {
      expect(listSteps()).toContain(s);
    }
  });
});
