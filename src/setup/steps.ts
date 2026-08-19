/**
 * setup/steps.ts —— 内置步骤：environment / timezone / set-env / verify
 *
 * 职责：environment（平台/docker 探测）；timezone（TZ 写 .env）；set-env（KEY=VALUE set-if-absent）；
 *       verify（.env/data 目录/控制 socket 存活性体检）。
 * 关键导出：registerBuiltinSteps
 * 借鉴：nanoclaw setup/{environment,timezone,set-env,verify}.ts 形态
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 8）
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { registerStep } from "./runner.js";
import { emitStatus } from "./status.js";
import { DATA_DIR, ENV_PATH } from "../config.js";

let builtinRegistered = false;

/** 幂等（P2 修复：重复调用静默返回，测试可安全调用） */
export function registerBuiltinSteps(): void {
  if (builtinRegistered) return;
  builtinRegistered = true;
  registerStep("environment", async () => {
    const docker = await new Promise<boolean>((resolve) => {
      execFile("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 5000 }, (err) => resolve(!err));
    });
    const kv = { platform: process.platform, node: process.version, docker };
    emitStatus("environment", kv);
    return kv;
  });

  registerStep("timezone", async (args) => {
    const tz = args[0] ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    const kv = { tz };
    emitStatus("timezone", kv);
    return kv;
  });

  registerStep("set-env", async (args) => {
    const [pair] = args;
    const eq = (pair ?? "").indexOf("=");
    if (eq <= 0) throw new Error("usage: set-env KEY=VALUE");
    const key = (pair ?? "").slice(0, eq).trim();
    const value = (pair ?? "").slice(eq + 1).trim();
    let existing = "";
    if (existsSync(ENV_PATH)) existing = readFileSync(ENV_PATH, "utf8");
    const has = existing.split(/\r?\n/).some((l) => l.startsWith(`${key}=`));
    if (!has) appendFileSync(ENV_PATH, `${key}=${value}\n`);
    const kv = { key, set: !has };
    emitStatus("set-env", kv);
    return kv;
  });

  registerStep("verify", async () => {
    mkdirSync(DATA_DIR, { recursive: true });
    const kv = { env: existsSync(ENV_PATH), dataDir: existsSync(DATA_DIR) };
    emitStatus("verify", kv);
    return kv;
  });
}
