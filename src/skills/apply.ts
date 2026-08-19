/**
 * skills/apply.ts —— 确定性技能应用引擎
 *
 * 职责：parse+validate → 获取输入（注入 resolver）→ 变更（copy/append/env-set/json-merge，journal + 幂等）
 *       → run（注入 exec）；blocked 闩锁；removeSkill = journal 倒放。
 * 关键导出：applySkill, removeSkill, ApplyResult, ApplyContext
 *
 * 核心模式与信任边界（se-inspector 复检修复后）：
 *   - degrade-to-agent：引擎不会的全弹回 agentTasks，不崩溃（逐指令 try/catch）不静默；
 *   - fs 收口：safeJoin 容纳校验（resolve+relative 防 .. 与绝对路径），越界 bounce（P0 修复）；
 *   - json-merge：损坏文件 bounce；journal 记旧值，回滚恢复（P1-2/3 修复）；
 *   - append：尾换行防护，journal 记实际写入文本（P1-9 修复）；
 *   - secret：prompt secret=true 的值进 secretVars（可替换）但排除出 res.vars（秘密不进上下文）；
 *   - blocked 后跳过 operator 展示/确认（基线语义）；
 *   - 与基线差异（刻意）：deferred 输入也置闩锁（更保守，headless 重跑不写半残副作用）。
 *   - 信任模型：技能体=受信代码；prompt 值经 substitute 进 shell 命令，作者自负其责（无 validate 属性，记录在案）。
 * 借鉴：nanoclaw scripts/skill-apply.ts
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 8）
 *   2026-08-13 复检修复：safeJoin 越界收口；逐指令 bounce；json-merge 损坏 bounce+旧值回滚；secret；尾换行；blocked 跳过 operator
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { parseDirectives, validateDirectives } from "./directives.js";

export interface ApplyContext {
  readPayload?: (path: string) => string | null;
  resolveInput?: (varName: string, text: string) => Promise<string | null>;
  exec?: (cmd: string) => Promise<{ ok: boolean; stdout: string }>;
  confirm?: (message: string) => Promise<boolean>;
  fsRoot: string;
  onEvent?: (ev: { type: string; detail?: string }) => Promise<void> | void;
}

export interface JournalEntry {
  op: "copy" | "append" | "env-set" | "json-merge";
  path?: string;
  /** append 实际写入文本（含可能的先导换行） */
  written?: string;
  key?: string;
  value?: string;
  /** json-merge 覆盖前的旧值（undefined = 键原先不存在） */
  prev?: string;
}

export interface ApplyResult {
  ok: boolean;
  applied: string[];
  skipped: string[];
  deferred: string[];
  agentTasks: string[];
  operatorMessages: string[];
  journal: JournalEntry[];
  /** 非机密变量（secret 排除在外） */
  vars: Record<string, string>;
  firstFailureHint: string | null;
}

/** P0 修复：fs 收口容纳校验；越界返回 null */
function safeJoin(fsRoot: string, rel: string): string | null {
  if (!rel || isAbsolute(rel)) return null;
  const resolved = resolve(fsRoot, rel);
  const rel2 = relative(resolve(fsRoot), resolved);
  if (rel2.startsWith("..") || isAbsolute(rel2)) return null;
  return resolved;
}

function envPath(root: string): string {
  return join(root, ".env");
}

function readEnv(root: string): Record<string, string> {
  const p = envPath(root);
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export async function applySkill(md: string, ctx: ApplyContext): Promise<ApplyResult> {
  const res: ApplyResult = {
    ok: true,
    applied: [],
    skipped: [],
    deferred: [],
    agentTasks: [],
    operatorMessages: [],
    journal: [],
    vars: {},
    firstFailureHint: null,
  };
  const secretVars: Record<string, string> = {};
  const allVars = (): Record<string, string> => ({ ...res.vars, ...secretVars });
  const substitute = (s: string): string =>
    s.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_m, k) => allVars()[k as string] ?? "");

  const validation = validateDirectives(md);
  if (validation.errors.length > 0) {
    return { ...res, ok: false, firstFailureHint: validation.errors[0] ?? "validation failed" };
  }
  let blocked = false;
  const block = (hint: string) => {
    blocked = true;
    if (!res.firstFailureHint) res.firstFailureHint = hint;
  };
  const bounce = (hint: string) => {
    res.agentTasks.push(hint);
    block(hint);
  };

  for (const d of parseDirectives(md)) {
    if (d.attrs.__unknown !== undefined) {
      bounce(`unknown directive at ${d.lineNo}; agent must interpret prose`);
      continue;
    }
    if (d.when && allVars()[d.when.var] !== d.when.value) {
      res.skipped.push(`when-guard line ${d.lineNo}`);
      continue;
    }
    await ctx.onEvent?.({ type: "step-start", detail: `${d.kind} @${d.lineNo}` });
    try {
      switch (d.kind) {
        case "operator": {
          if (blocked) {
            res.skipped.push(`operator @${d.lineNo} (blocked; not shown)`);
            break;
          }
          const text = substitute(d.body ?? d.attrs.text ?? "");
          res.operatorMessages.push(text);
          if (ctx.confirm) {
            const ok = await ctx.confirm(text);
            if (!ok) block(`operator declined at ${d.lineNo}`);
          }
          break;
        }
        case "prompt": {
          if (!ctx.resolveInput) {
            bounce(`prompt var=${d.attrs.var} needs agent acquisition`);
            break;
          }
          const val = await ctx.resolveInput(d.attrs.var ?? "input", substitute(d.body ?? d.attrs.text ?? ""));
          if (val === null) {
            res.deferred.push(`prompt var=${d.attrs.var}`);
            block(`deferred input var=${d.attrs.var}`); // 刻意差异：deferred 也置闩锁（更保守）
          } else if (d.attrs.secret === "true") {
            secretVars[d.attrs.var ?? "input"] = val; // secret 不进 res.vars
            res.applied.push(`prompt var=${d.attrs.var} (secret)`);
          } else {
            res.vars[d.attrs.var ?? "input"] = val;
            res.applied.push(`prompt var=${d.attrs.var}`);
          }
          break;
        }
        case "copy": {
          const to = safeJoin(ctx.fsRoot, substitute(d.attrs.to ?? ""));
          if (!to) {
            bounce(`copy to= escapes fsRoot at ${d.lineNo}`);
            break;
          }
          if (existsSync(to)) {
            res.skipped.push(`copy ${d.attrs.to} (exists)`);
            break;
          }
          if (blocked) {
            res.agentTasks.push(`copy ${d.attrs.to} deferred by blocked latch`);
            break;
          }
          const content = ctx.readPayload?.(d.attrs.from ?? "") ?? null;
          if (content === null) {
            bounce(`payload missing: ${d.attrs.from}`);
            break;
          }
          mkdirSync(dirname(to), { recursive: true });
          writeFileSync(to, content, { flag: "wx" });
          res.journal.push({ op: "copy", path: substitute(d.attrs.to ?? "") });
          res.applied.push(`copy ${d.attrs.to}`);
          break;
        }
        case "append": {
          const rel = substitute(d.attrs.file ?? "");
          const file = safeJoin(ctx.fsRoot, rel);
          if (!file) {
            bounce(`append file= escapes fsRoot at ${d.lineNo}`);
            break;
          }
          const line = substitute(d.attrs.line ?? d.body ?? "");
          const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
          if (existing.split(/\r?\n/).includes(line)) {
            res.skipped.push(`append ${rel} (line exists)`);
            break;
          }
          if (blocked) {
            res.agentTasks.push(`append ${rel} deferred by blocked latch`);
            break;
          }
          mkdirSync(dirname(file), { recursive: true });
          // P1-9 修复：尾换行防护，防行粘连
          const needsLead = existing.length > 0 && !existing.endsWith("\n");
          const written = (needsLead ? "\n" : "") + line + "\n";
          appendFileSync(file, written);
          res.journal.push({ op: "append", path: rel, written });
          res.applied.push(`append ${rel}`);
          break;
        }
        case "env-set": {
          const key = d.attrs.key ?? "";
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            bounce(`env-set invalid key: ${key}`);
            break;
          }
          const value = substitute(d.attrs.value ?? "");
          const env = readEnv(ctx.fsRoot);
          if (env[key] !== undefined) {
            res.skipped.push(`env-set ${key} (exists)`);
            break;
          }
          if (blocked) {
            res.agentTasks.push(`env-set ${key} deferred by blocked latch`);
            break;
          }
          appendFileSync(envPath(ctx.fsRoot), `${key}=${value}\n`);
          res.journal.push({ op: "env-set", key });
          res.applied.push(`env-set ${key}`);
          break;
        }
        case "json-merge": {
          const rel = substitute(d.attrs.file ?? "");
          const file = safeJoin(ctx.fsRoot, rel);
          if (!file) {
            bounce(`json-merge file= escapes fsRoot at ${d.lineNo}`);
            break;
          }
          const key = d.attrs.key ?? "";
          const value = substitute(d.attrs.value ?? "");
          if (blocked) {
            res.agentTasks.push(`json-merge ${rel} deferred by blocked latch`);
            break;
          }
          let obj: Record<string, unknown> = {};
          if (existsSync(file)) {
            const raw = readFileSync(file, "utf8");
            if (raw.trim().length > 0) {
              try {
                obj = JSON.parse(raw) as Record<string, unknown>;
              } catch {
                bounce(`json-merge target unparseable: ${rel} (agent must repair)`); // P1-2 修复：不静默清空
                break;
              }
            }
          }
          const prev = obj[key] !== undefined ? JSON.stringify(obj[key]) : undefined;
          obj[key] = value;
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, JSON.stringify(obj, null, 2));
          res.journal.push({ op: "json-merge", path: rel, key, value, prev }); // P1-3 修复：记旧值
          res.applied.push(`json-merge ${rel} ${key}`);
          break;
        }
        case "run": {
          if (blocked) {
            res.agentTasks.push(`run @${d.lineNo} deferred by blocked latch`);
            break;
          }
          if (!ctx.exec) {
            bounce(`run @${d.lineNo} needs agent execution`);
            break;
          }
          const cmd = substitute(d.body ?? "");
          const out = await ctx.exec(cmd);
          if (!out.ok) {
            bounce(`run failed @${d.lineNo}`);
            break;
          }
          if (d.attrs.capture) {
            res.vars[d.attrs.capture] = out.stdout.split(/\r?\n/)[0] ?? "";
          }
          res.applied.push(`run @${d.lineNo}`);
          break;
        }
        case "dep": {
          if (blocked) {
            res.agentTasks.push(`dep deferred by blocked latch`);
            break;
          }
          res.applied.push(`dep ${d.attrs.pkg ?? d.body ?? ""} (recorded; install via package manager)`);
          break;
        }
      }
    } catch (err) {
      // P1-1 修复：逐指令 bounce，引擎不崩溃
      bounce(`directive ${d.kind} @${d.lineNo} threw: ${String(err)}`);
    }
    await ctx.onEvent?.({ type: "step-end", detail: `${d.kind} @${d.lineNo}` });
  }
  res.ok = !blocked;
  return res;
}

/** removeSkill = journal 倒放（P1-8 修复：单条失败 try/catch 继续，不中断倒放） */
export function removeSkill(journal: JournalEntry[], fsRoot: string): void {
  for (const e of [...journal].reverse()) {
    try {
      switch (e.op) {
        case "copy": {
          const p = e.path ? safeJoin(fsRoot, e.path) : null;
          if (p) rmSync(p, { force: true });
          break;
        }
        case "append": {
          const p = e.path ? safeJoin(fsRoot, e.path) : null;
          if (!p || !e.written || !existsSync(p)) break;
          const content = readFileSync(p, "utf8");
          writeFileSync(p, content.replace(e.written, ""));
          break;
        }
        case "env-set": {
          const p = envPath(fsRoot);
          if (!existsSync(p) || !e.key) break;
          const lines = readFileSync(p, "utf8")
            .split(/\r?\n/)
            .filter((l) => !l.startsWith(`${e.key}=`));
          writeFileSync(p, lines.join("\n") + "\n");
          break;
        }
        case "json-merge": {
          const p = e.path ? safeJoin(fsRoot, e.path) : null;
          if (!p || !e.key || !existsSync(p)) break;
          const obj = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
          if (e.prev !== undefined) obj[e.key] = JSON.parse(e.prev);
          else delete obj[e.key];
          writeFileSync(p, JSON.stringify(obj, null, 2));
          break;
        }
      }
    } catch {
      continue; // 单条失败不中断倒放
    }
  }
}
