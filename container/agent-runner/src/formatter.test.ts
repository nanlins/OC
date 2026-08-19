/**
 * formatter.test.ts —— 消息格式化单元测试（bun:test）
 *
 * 职责：XML 协议块/分类/路由提取/内部标签剥离/无外层包裹。
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import { describe, expect, it } from "bun:test";
import { categorizeMessage, extractRouting, formatMessages, isClearCommand, stripInternalTags } from "./formatter.ts";
import type { MessageInRow } from "./db/messages-in.ts";

function row(over: Partial<MessageInRow>): MessageInRow {
  return {
    id: "m1",
    seq: 2,
    kind: "chat",
    timestamp: "2026-08-12T00:00:00Z",
    status: "pending",
    process_after: null,
    recurrence: null,
    series_id: null,
    tries: 0,
    trigger: 1,
    on_wake: 0,
    platform_id: "tg:1",
    channel_type: "telegram",
    thread_id: null,
    content: "hello",
    source_session_id: null,
    ...over,
  };
}

describe("formatter", () => {
  it("emits context header + per-message blocks without outer wrapper", () => {
    const out = formatMessages([row({})], { timezone: "Asia/Shanghai", assistantName: "Andy" });
    expect(out.startsWith('<context timezone="Asia/Shanghai" assistant="Andy" />')).toBe(true);
    expect(out).toContain('<message from="tg:1"');
    expect(out).toContain("hello");
    expect(out).not.toContain("<messages>");
  });

  it("task and system kinds map to task/system_response tags", () => {
    const out = formatMessages([row({ kind: "task" }), row({ kind: "system" })], { timezone: "UTC" });
    expect(out).toContain("<task ");
    expect(out).toContain("<system_response ");
  });

  it("categorizeMessage / isClearCommand / stripInternalTags", () => {
    expect(categorizeMessage("task")).toBe("task");
    expect(categorizeMessage("a2a")).toBe("system");
    expect(categorizeMessage("chat")).toBe("chat");
    expect(isClearCommand(" /clear ")).toBe(true);
    expect(isClearCommand("/clearx")).toBe(false);
    expect(stripInternalTags("a <internal>secret</internal> b")).toBe("a  b");
  });

  it("extractRouting takes last message routing", () => {
    expect(extractRouting([row({}), row({ platform_id: "x", channel_type: "cli", thread_id: "t" })])).toEqual({
      platformId: "x",
      channelType: "cli",
      threadId: "t",
    });
  });
});
