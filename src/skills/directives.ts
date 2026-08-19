/**
 * skills/directives.ts —— nc: 指令解析器 + lint
 *
 * 职责：fence info-string `nc:<kind> <attrs>` 解析；validate：未知指令/退役属性报错、
 *       {{var}} 先定义后使用、when: 守卫引用检查。两个读者一份文档（prose + 引擎）。
 * 关键导出：parseDirectives, validateDirectives, Directive
 * 借鉴：nanoclaw scripts/skill-directives.ts
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 8）
 */
export type DirectiveKind = "copy" | "append" | "env-set" | "json-merge" | "run" | "prompt" | "operator" | "dep";

export interface Directive {
  kind: DirectiveKind;
  attrs: Record<string, string>;
  /** run 的命令体（fence 内首行非 attr 行） */
  body?: string;
  lineNo: number;
  when?: { var: string; value: string };
}

const KINDS = new Set<DirectiveKind>(["copy", "append", "env-set", "json-merge", "run", "prompt", "operator", "dep"]);
/** 退役属性：出现即报错（过时的创作大声失败，nanoclaw 同语义） */
const RETIRED = ["min:", "error:", "open:", "gate:", "label:", "on-fail:"];

const FENCE_RE = /^```nc:\s*(.*)$/;

export function parseDirectives(md: string): Directive[] {
  const out: Directive[] = [];
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec((lines[i] ?? "").trim());
    if (!m) continue;
    const head = (m[1] ?? "").trim();
    const kindToken = head.split(/\s+/)[0] ?? "";
    if (!KINDS.has(kindToken as DirectiveKind)) {
      out.push({ kind: "run", attrs: { __unknown: kindToken }, lineNo: i + 1 });
      continue;
    }
    const startLine = i + 1;
    const attrs: Record<string, string> = {};
    let when: { var: string; value: string } | undefined;
    // 属性语法 k=v（值可含空格，lookahead 止于下一个 k=/k: 或行尾）；when: 单独形态
    const restHead = head.slice(kindToken.length).trim();
    // k=v 形态（值可含空格，lookahead 止于下一个 k=/k: 或行尾）
    const eqRe = /([a-zA-Z][a-zA-Z0-9-]*)=(.*?)(?=\s+[a-zA-Z][a-zA-Z0-9-]*[=:]|$)/g;
    let am: RegExpExecArray | null;
    while ((am = eqRe.exec(restHead))) {
      attrs[am[1] as string] = (am[2] ?? "").trim();
    }
    // k:v 形态（nanoclaw 原生形态，单 token）
    const colonRe = /(?:^|\s)([a-zA-Z][a-zA-Z0-9-]*):(\S+)/g;
    while ((am = colonRe.exec(restHead))) {
      const key = am[1] as string;
      if (key !== "when" && attrs[key] === undefined) attrs[key] = am[2] ?? "";
    }
    const wm = /when:([a-zA-Z][a-zA-Z0-9_]*)=(\S+)/.exec(restHead);
    if (wm) when = { var: wm[1] ?? "", value: wm[2] ?? "" };
    // fence 体直到闭合 ```（P1-4 修复：append 也消费体，防体内嵌 fence 被重扫成可执行指令）
    let body: string | undefined;
    let unclosed = false;
    if (kindToken === "run" || kindToken === "operator" || kindToken === "prompt" || kindToken === "append") {
      const buf: string[] = [];
      let closed = false;
      for (let j = i + 1; j < lines.length; j++) {
        if ((lines[j] ?? "").trim() === "```") {
          i = j;
          closed = true;
          break;
        }
        buf.push(lines[j] ?? "");
      }
      unclosed = !closed;
      body = buf.join("\n");
    }
    if (unclosed) attrs.__unclosed = "1";
    out.push({ kind: kindToken as DirectiveKind, attrs, body, lineNo: startLine, when });
  }
  return out;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export function validateDirectives(md: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const defined = new Set<string>();
  for (const d of parseDirectives(md)) {
    if (d.attrs.__unknown !== undefined) {
      errors.push(`line ${d.lineNo}: unknown directive: ${d.attrs.__unknown}`);
      continue;
    }
    // P2 修复：按解析后的属性键检查退役属性（避免子串误报，如 line=admin:root）
    for (const r of RETIRED) {
      const key = r.replace(":", "");
      if (d.attrs[key] !== undefined) errors.push(`line ${d.lineNo}: retired attribute ${r}`);
    }
    if (d.attrs.__unclosed) errors.push(`line ${d.lineNo}: unclosed fence`);
    if (d.when && !defined.has(d.when.var)) {
      errors.push(`line ${d.lineNo}: when: references undefined var ${d.when.var}`);
    }
    // {{var}} 先定义后使用
    const used = [...(d.body ?? "").matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)].map((x) => x[1]);
    for (const key of Object.values(d.attrs)) {
      used.push(...[...key.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)].map((x) => x[1]));
    }
    for (const v of used) {
      if (v && !defined.has(v)) errors.push(`line ${d.lineNo}: {{${v}}} used before definition`);
    }
    const promptVar = d.attrs.var;
    if (d.kind === "prompt" && promptVar) defined.add(promptVar);
    const captureVar = d.attrs.capture;
    if (d.kind === "run" && captureVar) defined.add(captureVar);
    if (d.kind === "dep") {
      const spec = d.attrs.pkg ?? d.body ?? "";
      if (!/^[a-z0-9@][a-z0-9/._-]*@\d/.test(spec)) warnings.push(`line ${d.lineNo}: dep should pin exact version`);
    }
  }
  return { errors, warnings };
}
