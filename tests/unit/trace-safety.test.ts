/**
 * trace-safety.test.ts —— trace id 路径穿越防御单元测试（fix-plan P0）
 *
 * 修改记录：2026-08-14 创建（fix-plan P0：/api/traces/:id 路径穿越回归）
 */
import { describe, expect, it } from "vitest";
import { isSafeTraceId } from "../../src/eval/trace.js";

describe("isSafeTraceId (path traversal defense)", () => {
  it("accepts normal session ids", () => {
    expect(isSafeTraceId("5e4ee59a-6ac7-4624-996f-1a2b3c4d5e6f")).toBe(true);
    expect(isSafeTraceId("session_123")).toBe(true);
    expect(isSafeTraceId("a.b.c")).toBe(true);
  });
  it("rejects traversal and separator payloads", () => {
    expect(isSafeTraceId("../package")).toBe(false);
    expect(isSafeTraceId("..\\..\\secret")).toBe(false);
    expect(isSafeTraceId("a/b")).toBe(false);
    expect(isSafeTraceId("a\\b")).toBe(false);
    expect(isSafeTraceId("foo/../../bar")).toBe(false);
    expect(isSafeTraceId("")).toBe(false);
    expect(isSafeTraceId("a\0b")).toBe(false);
  });
  it("lone '..' is neutralized by .jsonl suffix (no separator, stays in dir)", () => {
    expect(isSafeTraceId("..")).toBe(true);
  });
});
