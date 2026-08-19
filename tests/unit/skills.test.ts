/**
 * skills.test.ts —— 技能引擎测试（解析/lint/策略/apply 幂等+journal 回滚）
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 8）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDirectives, validateDirectives } from "../../src/skills/directives.js";
import { gatePolicy, extractOfferUrl } from "../../src/skills/policy.js";
import { applySkill, removeSkill, type ApplyResult } from "../../src/skills/apply.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-skill-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SKILL_MD = `
# add-demo

prose for agents...

\`\`\`nc:prompt var=token text=enter token
\`\`\`

\`\`\`nc:operator
about to write config
\`\`\`

\`\`\`nc:env-set key=DEMO_TOKEN value={{token}}
\`\`\`

\`\`\`nc:append file=notes.txt line=demo line
\`\`\`
`;

describe("directives", () => {
  it("parses kinds and attrs", () => {
    const dirs = parseDirectives(SKILL_MD);
    expect(dirs.map((d) => d.kind)).toEqual(["prompt", "operator", "env-set", "append"]);
    const env = dirs.find((d) => d.kind === "env-set");
    expect(env?.attrs.key).toBe("DEMO_TOKEN");
    expect(env?.attrs.value).toBe("{{token}}");
  });

  it("validate flags unknown directive and retired attrs and undefined vars", () => {
    const bad = `
\`\`\`nc:frobnicate x=1
\`\`\`
\`\`\`nc:run gate:true
echo hi
\`\`\`
\`\`\`nc:append file=a.txt line={{nope}}
\`\`\`
`;
    const v = validateDirectives(bad);
    expect(v.errors.some((e) => e.includes("unknown directive"))).toBe(true);
    expect(v.errors.some((e) => e.includes("retired attribute gate:"))).toBe(true);
    expect(v.errors.some((e) => e.includes("{{nope}}"))).toBe(true);
  });

  it("when-guard references must be defined", () => {
    const md = `
\`\`\`nc:run when:mode=auto
echo x
\`\`\`
`;
    expect(validateDirectives(md).errors.some((e) => e.includes("when:"))).toBe(true);
  });
});

describe("policy", () => {
  it("operator followed by side-effect requires confirm", () => {
    expect(gatePolicy(SKILL_MD).needsConfirm).toBe(true);
  });
  it("no side-effect after operator → no confirm", () => {
    const md = `
\`\`\`nc:operator
just info
\`\`\`
`;
    expect(gatePolicy(md).needsConfirm).toBe(false);
  });
  it("extractOfferUrl strips punctuation and rejects placeholders", () => {
    expect(extractOfferUrl("open https://example.com/setup.")).toBe("https://example.com/setup");
    expect(extractOfferUrl("see {{url}}")).toBeNull();
  });
});

describe("apply engine", () => {
  it("applies idempotently and journals; second run skips", async () => {
    let confirmCalls = 0;
    const ctx = {
      fsRoot: dir,
      resolveInput: async (_v: string, _t: string) => "sekrit",
      confirm: async () => {
        confirmCalls += 1;
        return true;
      },
    };
    const first: ApplyResult = await applySkill(SKILL_MD, ctx);
    expect(first.ok).toBe(true);
    expect(confirmCalls).toBe(1);
    expect(readFileSync(join(dir, ".env"), "utf8")).toContain("DEMO_TOKEN=sekrit");
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).toContain("demo line");

    const second = await applySkill(SKILL_MD, ctx);
    expect(second.skipped.length).toBeGreaterThanOrEqual(2);
    expect(readFileSync(join(dir, "notes.txt"), "utf8").split("demo line").length).toBe(2); // 未重复追加
  });

  it("blocked latch defers side effects after declined operator", async () => {
    const ctx = {
      fsRoot: dir,
      resolveInput: async () => "x",
      confirm: async () => false,
    };
    const res = await applySkill(SKILL_MD, ctx);
    expect(res.ok).toBe(false);
    expect(existsSync(join(dir, ".env")) ? readFileSync(join(dir, ".env"), "utf8") : "").not.toContain("DEMO_TOKEN");
    expect(res.agentTasks.length).toBeGreaterThan(0);
  });

  it("removeSkill replays journal in reverse", async () => {
    const res = await applySkill(SKILL_MD, { fsRoot: dir, resolveInput: async () => "v", confirm: async () => true });
    removeSkill(res.journal, dir);
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).not.toContain("demo line");
    expect(readFileSync(join(dir, ".env"), "utf8")).not.toContain("DEMO_TOKEN");
  });

  it("deferred input blocks subsequent side effects", async () => {
    const res = await applySkill(SKILL_MD, { fsRoot: dir, resolveInput: async () => null, confirm: async () => true });
    expect(res.ok).toBe(false);
    expect(res.deferred.length).toBeGreaterThan(0);
  });

  it("P0 regression: copy/append escaping fsRoot bounce", async () => {
    const md = `
\`\`\`nc:copy from=a.txt to=../../evil.txt
\`\`\`
\`\`\`nc:append file=../outside.txt line=x
\`\`\`
`;
    const res = await applySkill(md, { fsRoot: dir, readPayload: () => "x", confirm: async () => true });
    expect(res.ok).toBe(false);
    expect(res.agentTasks.some((t) => t.includes("escapes fsRoot"))).toBe(true);
  });

  it("P1 regression: json-merge unparseable target bounces (no silent wipe)", async () => {
    writeFileSync(join(dir, "cfg.json"), "{ not valid json !!!");
    const md = `
\`\`\`nc:json-merge file=cfg.json key=a value=1
\`\`\`
`;
    const res = await applySkill(md, { fsRoot: dir });
    expect(res.ok).toBe(false);
    expect(readFileSync(join(dir, "cfg.json"), "utf8")).toContain("not valid json");
  });

  it("P1 regression: json-merge rollback restores previous value", async () => {
    writeFileSync(join(dir, "cfg2.json"), JSON.stringify({ keep: "old" }));
    const md = `
\`\`\`nc:json-merge file=cfg2.json key=keep value=new
\`\`\`
`;
    const res = await applySkill(md, { fsRoot: dir });
    expect(res.ok).toBe(true);
    removeSkill(res.journal, dir);
    expect(JSON.parse(readFileSync(join(dir, "cfg2.json"), "utf8")).keep).toBe("old");
  });

  it("P1 regression: secret prompt values excluded from res.vars", async () => {
    const md = `
\`\`\`nc:prompt var=tok secret=true text=token?
\`\`\`
`;
    const res = await applySkill(md, { fsRoot: dir, resolveInput: async () => "hush" });
    expect(res.ok).toBe(true);
    expect(res.vars.tok).toBeUndefined();
  });

  it("P1 regression: unclosed fence fails validation", () => {
    const md = "```nc:run\necho hi\n";
    expect(validateDirectives(md).errors.some((e) => e.includes("unclosed fence"))).toBe(true);
  });

  it("P1 regression: exec failure bounces without crashing", async () => {
    const md = `
\`\`\`nc:run
false
\`\`\`
`;
    const res = await applySkill(md, { fsRoot: dir, exec: async () => ({ ok: false, stdout: "" }) });
    expect(res.ok).toBe(false);
    expect(res.agentTasks.some((t) => t.includes("run failed"))).toBe(true);
  });
});
