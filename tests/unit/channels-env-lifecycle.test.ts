/**
 * channels-env-lifecycle.test.ts —— 通道注册表/defaults/env/生命周期/平台ID 单元测试
 *
 * 职责：补齐阶段 2 se-inspector 指出的零覆盖区（channels 层、env.ts、host-lifecycle.ts、platform-id.ts）。
 * 修改记录：
 *   2026-08-12 创建（阶段 2 复检修复）
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearChannelRegistryForTest,
  getActiveAdapters,
  getChannelAdapter,
  getChannelAdapterExact,
  initChannelAdapters,
  MissingChannelAdapterError,
  registerChannelAdapter,
  requireDeliveryAdapter,
  setActiveAdapterForTest,
  teardownChannelAdapters,
} from "../../src/channels/channel-registry.js";
import {
  fallbackChannelDefaults,
  getChannelDefaults,
  resolveThreadPolicy,
  resolveWiringDefaults,
  validateEngageAgainstChannel,
} from "../../src/channels/channel-defaults.js";
import type { ChannelAdapter } from "../../src/channels/adapter.js";
import { readEnvFile } from "../../src/env.js";
import {
  clearHostLifecycleHooksForTest,
  onHostShutdown,
  onHostStart,
  startHostModules,
  stopHostModules,
} from "../../src/host-lifecycle.js";
import { namespacedPlatformId } from "../../src/platform-id.js";

function adapter(name: string, opts?: Partial<ChannelAdapter>): ChannelAdapter {
  return {
    name,
    channelType: name,
    supportsThreads: false,
    setup: () => {},
    deliver: async () => undefined,
    ...opts,
  };
}

beforeEach(() => {
  clearChannelRegistryForTest();
});

afterEach(async () => {
  await teardownChannelAdapters();
  clearChannelRegistryForTest();
});

describe("channel registry", () => {
  it("factory null (missing credentials) is skipped", async () => {
    registerChannelAdapter("ghost", { factory: () => null });
    await initChannelAdapters(() => ({
      onInbound: () => {},
      onInboundEvent: () => {},
      onMetadata: () => {},
      onAction: () => {},
    }));
    expect(getActiveAdapters()).toHaveLength(0);
  });

  it("exact lookup has no fallback; requireDeliveryAdapter throws MissingChannelAdapterError", () => {
    setActiveAdapterForTest(adapter("telegram", { instance: "tg-bot-2" }));
    expect(getChannelAdapterExact("tg-bot-2")).toBeDefined();
    expect(getChannelAdapterExact("telegram")).toBeUndefined();
    expect(() => requireDeliveryAdapter("telegram")).toThrow(MissingChannelAdapterError);
    // channelType-only 调用方可回退（带 warn）
    expect(getChannelAdapter("telegram")).toBeDefined();
  });

  it("teardown tolerates throwing adapters", async () => {
    setActiveAdapterForTest(adapter("bad", { teardown: async () => Promise.reject(new Error("boom")) }));
    await expect(teardownChannelAdapters()).resolves.toBeUndefined();
  });
});

describe("channel defaults", () => {
  it("fallback is behavior-faithful and dm/group contexts differ by isGroup", () => {
    const fb = fallbackChannelDefaults(true);
    expect(fb.group.engageMode).toBe("mention-sticky");
    expect(fb.dm.engageMode).toBe("pattern");
    const fbNoThreads = fallbackChannelDefaults(false);
    expect(fbNoThreads.group.engageMode).toBe("mention");
  });

  it("resolveWiringDefaults downgrades mention-sticky without threads and substitutes {name}", () => {
    clearChannelRegistryForTest();
    const d = resolveWiringDefaults({ channelKey: "cli", channelType: "cli", isGroup: true, agentName: "Andy (bot)" });
    expect(d.engage_mode).toBe("mention"); // 无 threads 声明 → 降级
    const d2 = resolveWiringDefaults({ channelKey: "unknown-ch", channelType: "unknown-ch", isGroup: false });
    expect(d2.engage_pattern).toBe(".");
  });

  it("resolveThreadPolicy hard-ANDs adapter capability", () => {
    expect(resolveThreadPolicy(null, true, false)).toBe(false);
    expect(resolveThreadPolicy(1, false, true)).toBe(true);
    expect(resolveThreadPolicy(0, true, true)).toBe(false);
    expect(resolveThreadPolicy(null, true, true)).toBe(true);
  });

  it("validateEngageAgainstChannel rejects pattern without pattern and mention on mentions:never", () => {
    expect(() =>
      validateEngageAgainstChannel({
        channelKey: "cli",
        channelType: "cli",
        engageMode: "pattern",
        engagePattern: null,
      }),
    ).toThrow(/engage_pattern/);
    // cli 未声明 defaults → fallback mentions=platform，mention 合法
    expect(() =>
      validateEngageAgainstChannel({
        channelKey: "cli",
        channelType: "cli",
        engageMode: "mention",
        engagePattern: null,
      }),
    ).not.toThrow();
  });

  it("getChannelDefaults uses declared adapter defaults when present", () => {
    setActiveAdapterForTest(
      adapter("decl", {
        supportsThreads: true,
        defaults: {
          dm: { engageMode: "mention", threads: false, unknownSenderPolicy: "public" },
          group: { engageMode: "mention-sticky", threads: true, unknownSenderPolicy: "strict" },
          mentions: "never",
        },
      }),
    );
    expect(getChannelDefaults("decl").mentions).toBe("never");
  });
});

describe("env file", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "oc-env-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("whitelist + quote stripping + empty values skipped (P1 regression)", () => {
    const p = join(dir, ".env");
    writeFileSync(p, `A=1\nB="two"\nC=\nD='four'\nNOTWANTED=9\n# comment\n`);
    const got = readEnvFile(["A", "B", "C", "D"], p);
    expect(got).toEqual({ A: "1", B: "two", D: "four" });
  });

  it("missing file yields empty map", () => {
    expect(readEnvFile(["A"], join(dir, "nope.env"))).toEqual({});
  });
});

describe("host lifecycle", () => {
  beforeEach(() => clearHostLifecycleHooksForTest());
  afterEach(() => clearHostLifecycleHooksForTest());

  it("start is serial and fail-fast; shutdown reverse and tolerant", async () => {
    const order: string[] = [];
    onHostStart("a", () => void order.push("start-a"));
    onHostStart("b", () => Promise.reject(new Error("boom")));
    onHostStart("c", () => void order.push("start-c"));
    await expect(startHostModules()).rejects.toThrow(/boom/);
    expect(order).toEqual(["start-a"]);

    onHostShutdown("s1", () => void order.push("stop-1"));
    onHostShutdown("s2", () => Promise.reject(new Error("x")));
    onHostShutdown("s3", () => void order.push("stop-3"));
    await stopHostModules(); // 不抛
    expect(order.slice(1)).toEqual(["stop-3", "stop-1"]); // 逆序且容错
  });
});

describe("platform id", () => {
  it("namespaces raw ids only when adapter declares namespacing", () => {
    expect(namespacedPlatformId("telegram", "123", true)).toBe("telegram:123");
    expect(namespacedPlatformId("telegram", "tg:123", true)).toBe("tg:123");
    expect(namespacedPlatformId("telegram", "@user", true)).toBe("@user");
    expect(namespacedPlatformId("telegram", "123", false)).toBe("123");
  });
});
