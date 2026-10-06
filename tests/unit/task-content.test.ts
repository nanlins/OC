/**
 * task-content.test.ts —— 任务内容信封单测（P0-3）
 *
 * 职责：parseTaskContent（信封 + 纯字符串兼容 + 坏 JSON 不丢任务）；
 *       composeTaskContent（无 script 时保持纯字符串形态，旧容器完全兼容）。
 *
 * 修改记录：2026-10-06 创建（P0-3）
 */
import { describe, expect, it } from "vitest";
import { composeTaskContent, parseTaskContent } from "../../src/modules/scheduling/task-content.js";

describe("parseTaskContent", () => {
  it("parses the full envelope", () => {
    expect(parseTaskContent(JSON.stringify({ prompt: "p", script: "true", originSessionId: "s1" }))).toEqual({
      prompt: "p",
      script: "true",
      originSessionId: "s1",
    });
  });

  it("parses a prompt-only envelope", () => {
    expect(parseTaskContent(JSON.stringify({ prompt: "p" }))).toEqual({
      prompt: "p",
      script: null,
      originSessionId: null,
    });
  });

  it("legacy plain-string tasks parse as prompt-only", () => {
    expect(parseTaskContent("run the report")).toEqual({
      prompt: "run the report",
      script: null,
      originSessionId: null,
    });
  });

  it("malformed JSON falls back to the raw string (task is never lost)", () => {
    const env = parseTaskContent("{broken");
    expect(env.prompt).toBe("{broken");
    expect(env.script).toBeNull();
  });

  it("objects with unknown keys are not envelopes", () => {
    const env = parseTaskContent(JSON.stringify({ type: "task", message: "x" }));
    expect(env.script).toBeNull();
    expect(env.prompt).toBe(JSON.stringify({ type: "task", message: "x" }));
  });
});

describe("composeTaskContent", () => {
  it("keeps plain-string shape when no script/originSessionId (legacy containers read content as prompt)", () => {
    expect(composeTaskContent({ prompt: "hi" })).toBe("hi");
  });

  it("emits the JSON envelope when a script is present", () => {
    const out = composeTaskContent({ prompt: "hi", script: "echo ok", originSessionId: null });
    expect(JSON.parse(out)).toEqual({ prompt: "hi", script: "echo ok", originSessionId: null });
  });

  it("round-trips through parseTaskContent", () => {
    const composed = composeTaskContent({ prompt: "p", script: "true", originSessionId: "s" });
    expect(parseTaskContent(composed)).toEqual({ prompt: "p", script: "true", originSessionId: "s" });
  });
});
