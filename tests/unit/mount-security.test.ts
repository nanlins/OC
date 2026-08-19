/**
 * mount-security.test.ts —— 挂载安全校验单元测试
 *
 * 职责：白名单根匹配/符号链接绕过拒绝/绝对容器路径拒绝（沙箱 extra）/blocked patterns/RW 双重条件/缺失宿主拒绝。
 * 修改记录：
 *   2026-08-12 创建（阶段 3 复检修复）
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearMountSecurityCacheForTest,
  setMountAllowlistPathForTest,
  validateAdditionalMounts,
} from "../../src/modules/mount-security.js";

let work: string;
let allowed: string;
let outside: string;
let allowlistPath: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "oc-mount-"));
  allowed = join(work, "allowed");
  outside = join(work, "outside");
  mkdirSync(allowed, { recursive: true });
  mkdirSync(outside, { recursive: true });
  allowlistPath = join(work, "allowlist.json");
  writeFileSync(
    allowlistPath,
    JSON.stringify({ roots: [{ path: allowed, allowReadWrite: true }], blockedPatterns: [".ssh"] }),
  );
  setMountAllowlistPathForTest(allowlistPath);
});

afterEach(() => {
  setMountAllowlistPathForTest(null);
  clearMountSecurityCacheForTest();
  rmSync(work, { recursive: true, force: true });
});

describe("mount-security", () => {
  it("allows whitelisted root and sandboxes container path under /workspace/extra/", () => {
    const out = validateAdditionalMounts([{ host: allowed, container: "data", readonly: false }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.container).toBe("/workspace/extra/data");
    expect(out[0]!.host).toBe(resolve(allowed));
    expect(out[0]!.readonly).toBe(false); // 根 allowReadWrite ∧ 显式请求
  });

  it("rejects absolute container paths (shadowing protection)", () => {
    expect(validateAdditionalMounts([{ host: allowed, container: "/workspace/inbound.db" }])).toEqual([]);
    expect(validateAdditionalMounts([{ host: allowed, container: "../escape" }])).toEqual([]);
  });

  it("rejects symlink bypassing the allowlist (realpath validation)", () => {
    const link = join(allowed, "sneaky");
    symlinkSync(outside, link);
    expect(validateAdditionalMounts([{ host: link, container: "x" }])).toEqual([]);
  });

  it("rejects host paths outside allowlist and missing hosts", () => {
    expect(validateAdditionalMounts([{ host: outside, container: "x" }])).toEqual([]);
    expect(validateAdditionalMounts([{ host: join(work, "nope"), container: "x" }])).toEqual([]);
  });

  it("blocked patterns rejected even inside allowlist", () => {
    const ssh = join(allowed, ".ssh");
    mkdirSync(ssh, { recursive: true });
    expect(validateAdditionalMounts([{ host: ssh, container: "x" }])).toEqual([]);
  });

  it("RW requires explicit request AND root permission (else forced RO)", () => {
    const ro = validateAdditionalMounts([{ host: allowed, container: "x" }]); // 未显式请求 RW
    expect(ro[0]!.readonly).toBe(true);
  });
});
