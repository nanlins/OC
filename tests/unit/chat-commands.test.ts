/**
 * chat-commands.test.ts —— /setup 参数解析单测（阶段 15）
 *
 * 职责：parseSetupArgs 的 provider 识别/URL 首参默认 openai/各供应商 env 映射/错误分支。
 * 修改记录：2026-09-01 创建
 */
import { describe, expect, it } from "vitest";
import { parseSetupArgs } from "../../src/modules/chat-commands.js";

describe("chat-commands parseSetupArgs", () => {
  it("URL 首参默认 openai（省略 provider 直接贴 端点+密钥+模型）", () => {
    const r = parseSetupArgs("https://api.deepseek.com/v1 sk-abc123 deepseek-chat");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provider).toBe("openai");
    expect(r.env.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(r.env.OPENAI_API_KEY).toBe("sk-abc123");
    expect(r.model).toBe("deepseek-chat");
    expect(r.env.DEFAULT_AGENT_PROVIDER).toBe("openai");
  });

  it("显式 openai provider", () => {
    const r = parseSetupArgs("openai https://api.test.com/v1 sk-y");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provider).toBe("openai");
    expect(r.env.OPENAI_BASE_URL).toBe("https://api.test.com/v1");
    expect(r.env.OPENAI_API_KEY).toBe("sk-y");
    expect(r.model).toBe("");
  });

  it("claude 映射 ANTHROPIC_API_KEY", () => {
    const r = parseSetupArgs("claude sk-ant-x model-z");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provider).toBe("claude");
    expect(r.env.ANTHROPIC_API_KEY).toBe("sk-ant-x");
    expect(r.model).toBe("model-z");
  });

  it("ollama 默认地址", () => {
    const r = parseSetupArgs("ollama");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.env.OLLAMA_HOST).toBe("http://127.0.0.1:11434");
  });

  it("mock 通过", () => {
    const r = parseSetupArgs("mock");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provider).toBe("mock");
  });

  it("未知 provider 报错", () => {
    const r = parseSetupArgs("foobar x y");
    expect(r.ok).toBe(false);
  });

  it("openai 缺密钥报错", () => {
    const r = parseSetupArgs("openai https://x.example/v1");
    expect(r.ok).toBe(false);
  });

  it("拦截无域名后缀的 BASE_URL 笔误（api.deepseek）", () => {
    const r = parseSetupArgs("https://api.deepseek sk-x m");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("主机名无效");
  });

  it("放行 localhost 回环地址（ollama 本地）", () => {
    const r = parseSetupArgs("openai http://localhost:11434/v1 sk-x");
    expect(r.ok).toBe(true);
  });
});
/*
 * 修改记录：2026-09-01 创建
 */
