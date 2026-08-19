/**
 * skills-engine.test.ts —— 技能引擎测试（loader/容器技能 lint/安装技能 apply）
 *
 * 职责：frontmatter 解析；技能预算截断；20 个容器技能 frontmatter 完整性 lint；
 *       安装技能 nc: 指令 validate 通过 + applySkill 幂等应用。
 *
 * 修改记录：2026-08-13 创建（阶段 13）；同日移除未用导入/变量（lint 修复）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkills, renderSkillsSection } from "../../container/agent-runner/src/skills/loader.js";
import { parseDirectives, validateDirectives } from "../../src/skills/directives.js";
import { applySkill } from "../../src/skills/apply.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const CONTAINER_SKILLS = join(ROOT, "container/skills");
const HOST_SKILLS = join(ROOT, "skills");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-skills-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("skills loader", () => {
  it("parses frontmatter and sorts by name", () => {
    mkdirSync(join(dir, "b-skill"), { recursive: true });
    mkdirSync(join(dir, "a-skill"), { recursive: true });
    writeFileSync(join(dir, "b-skill", "SKILL.md"), "---\nname: b\ndescription: db\n---\nbody b\n");
    writeFileSync(join(dir, "a-skill", "SKILL.md"), "---\nname: a\ndescription: da\n---\nbody a\n");
    const skills = loadSkills(dir);
    expect(skills.map((s) => s.name)).toEqual(["a", "b"]);
    expect(skills[0]!.body).toContain("body a");
  });

  it("renderSkillsSection truncates by budget with marker", () => {
    const skills = [
      { name: "x", description: "", body: "x".repeat(100) },
      { name: "y", description: "", body: "y".repeat(100) },
    ];
    const out = renderSkillsSection(skills, 150);
    expect(out).toContain("truncated by budget");
    expect(out).toContain("skill: x");
    expect(out).not.toContain("skill: y");
  });
});

describe("container skills lint (20 skills)", () => {
  it("every container skill has name + description + body", () => {
    const skills = loadSkills(CONTAINER_SKILLS);
    expect(skills.length).toBeGreaterThanOrEqual(20);
    for (const s of skills) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(10);
      expect(s.body.length).toBeGreaterThan(100);
    }
  });
});

describe("host install skills", () => {
  it("add-eval-corpus directives validate", () => {
    const raw = readFileSync(join(HOST_SKILLS, "add-eval-corpus", "SKILL.md"), "utf8");
    const v = validateDirectives(raw);
    expect(v.errors).toEqual([]);
    expect(parseDirectives(raw).map((d) => d.kind)).toContain("copy");
    expect(parseDirectives(raw).map((d) => d.kind)).toContain("append");
  });

  it("add-webhook-channel applies env-set idempotently", async () => {
    const raw = readFileSync(join(HOST_SKILLS, "add-webhook-channel", "SKILL.md"), "utf8");
    const res = await applySkill(raw, {
      fsRoot: dir,
      resolveInput: async () => "sekrit",
      confirm: async () => true,
    });
    expect(res.ok).toBe(true);
    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env).toContain("WEBHOOK_HMAC_SECRET=sekrit");
    const second = await applySkill(raw, { fsRoot: dir, resolveInput: async () => "other", confirm: async () => true });
    expect(second.ok).toBe(true);
    const env2 = readFileSync(join(dir, ".env"), "utf8");
    expect(env2).toContain("WEBHOOK_HMAC_SECRET=sekrit"); // set-if-absent 幂等
    expect(env2).not.toContain("other");
  });
});
