/**
 * mcp-tools/kb-search.ts —— kb_search 工具：群组知识库检索（fix-plan：kb_search 接入 agent）
 *
 * 职责：在容器内检索 KB 目录（默认 /workspace/agent/kb，可经 OPENCLAW_KB_DIR 注入）的 md/txt 文件；
 *       递归分块 + CJK bigram/latin 分词 + 覆盖率打分 + 阈值过滤 + 引用溯源（source）。
 * 架构说明：agent 运行于容器、与宿主中央 DB 隔离，故 KB 为容器工作区内文件（宿主 memory-kb 的镜像/投放点），
 *       使 kb_search 成为可同步返回的 in-container 工具；embedding 版检索在宿主 memory-kb（searchKbVector）。
 * 关键导出：registerKbSearchTool, tokenizeKb, chunkKbText
 * 承重不变量：只在 KB 目录内读取（resolve 后前缀校验）；文件数/深度上限防资源放大。
 *
 * 修改记录：2026-08-14 创建（fix-plan：kb_search 接入 agent）
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { getWorkspace } from "../db/connection.ts";
import { registerTools } from "./registry.ts";

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 60;
const MIN_SCORE = 0.05;
const MAX_FILES = 200;
const MAX_DEPTH = 4;
const MAX_FILE_CHARS = 200_000;

/** CJK 连续串切 bigram，latin/数字整词（与宿主 memory-kb.tokenize 对齐） */
export function tokenizeKb(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLowerCase().match(/[a-z0-9]+|[一-鿿\u3040-\u30ff]+/g) ?? []) {
    if (/^[a-z0-9]+$/.test(m) || m.length === 1) {
      out.push(m);
      continue;
    }
    for (let i = 0; i < m.length - 1; i++) out.push(m.slice(i, i + 2));
  }
  return out;
}

/** 递归分块（按分隔符优先级，超段降级细分隔符） */
export function chunkKbText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP, seps = ["\n\n", "\n", "。", " "]): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= size) return [t];
  const sep = seps.find((s) => s !== "" && t.includes(s));
  if (!sep) {
    const out: string[] = [];
    for (let i = 0; i < t.length; i += Math.max(1, size - overlap)) out.push(t.slice(i, i + size));
    return out.filter(Boolean);
  }
  const rest = seps.slice(seps.indexOf(sep) + 1);
  const out: string[] = [];
  let cur = "";
  for (const p of t.split(sep)) {
    const piece = p + sep;
    if (cur.length + piece.length > size && cur) {
      out.push(...chunkKbText(cur.trim(), size, overlap, rest));
      cur = overlap ? cur.slice(-overlap) : "";
    }
    cur += piece;
  }
  if (cur.trim()) out.push(...chunkKbText(cur.trim(), size, overlap, rest));
  return out.filter(Boolean);
}

export function kbDir(): string {
  return process.env.OPENCLAW_KB_DIR ?? join(getWorkspace(), "agent", "kb");
}

interface KbChunk {
  title: string;
  content: string;
  source: string;
  tokens: string[];
}

/** 有界遍历 KB 目录收集 chunk（限深/限文件数/限单文件大小） */
function loadKbChunks(dir: string): KbChunk[] {
  const root = resolve(dir);
  const chunks: KbChunk[] = [];
  let fileCount = 0;
  const walk = (d: string, depth: number): void => {
    if (depth > MAX_DEPTH || fileCount >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (fileCount >= MAX_FILES) return;
      const full = join(d, e.name);
      // 只在 KB 根目录内（防符号链接/相对逃逸）
      if (!resolve(full).startsWith(root)) continue;
      if (e.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!e.isFile() || !/\.(md|txt|markdown)$/i.test(e.name)) continue;
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.size > MAX_FILE_CHARS) continue;
      let text: string;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      fileCount += 1;
      const source = relative(root, full).replace(/\\/g, "/");
      const title = e.name.replace(/\.(md|txt|markdown)$/i, "");
      for (const c of chunkKbText(text)) {
        chunks.push({ title, content: c, source, tokens: tokenizeKb(c) });
      }
    }
  };
  walk(root, 0);
  return chunks;
}

export function registerKbSearchTool(): void {
  registerTools([
    {
      name: "kb_search",
      description:
        "Search the group knowledge base (markdown/text files in the kb directory) and return the most relevant chunks with source citations. Use for factual questions answerable from the knowledge base. Returns empty hits when nothing is relevant — then say you cannot answer from the KB.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "search query" },
          k: { type: "number", description: "max hits to return (default 4)" },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const query = String(args.query ?? "");
        const k = Math.min(Math.max(Number(args.k) || 4, 1), 10);
        const dir = kbDir();
        if (!existsSync(dir)) return { hits: [], note: `kb directory not found: ${dir}` };
        const chunks = loadKbChunks(dir);
        const qTokens = tokenizeKb(query);
        if (qTokens.length === 0 || chunks.length === 0) return { hits: [] };
        const scored = chunks.map((c) => {
          const tokSet = new Set(c.tokens);
          let hit = 0;
          for (const q of qTokens) {
            if (tokSet.has(q) || c.tokens.some((t) => t.includes(q) || q.includes(t))) hit += 1;
          }
          return { title: c.title, content: c.content, source: c.source, score: hit / qTokens.length };
        });
        const hits = scored
          .filter((s) => s.score >= MIN_SCORE)
          .sort((a, b) => b.score - a.score)
          .slice(0, k);
        return { hits };
      },
    },
  ]);
}
