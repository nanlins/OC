/**
 * mcp-tools/kb-search.ts ?”â€?kb_search å·¥å…·ï¼šç¾¤ç»„çŸ¥è¯†å?æ£€ç´¢ï?fix-planï¼škb_search ?¥å…¥ agentï¼? *
 * ?Œè´£ï¼šåœ¨å®¹å™¨?…æ?ç´?KB ?®å?ï¼ˆé?è®?/workspace/agent/kbï¼Œå¯ç»?OC_KB_DIR æ³¨å…¥ï¼‰ç? md/txt ?‡ä»¶ï¼? *       ?’å??†å? + CJK bigram/latin ?†è? + è¦†ç??‡æ???+ ?ˆå€¼è?æ»?+ å¼•ç”¨æº¯æ?ï¼ˆsourceï¼‰ã€? * ?¶æ?è¯´æ?ï¼šagent è¿è?äºå®¹?¨ã€ä?å®¿ä¸»ä¸­å¤® DB ?”ç¦»ï¼Œæ? KB ä¸ºå®¹?¨å·¥ä½œåŒº?…æ?ä»¶ï?å®¿ä¸» memory-kb ?„é????•æ”¾?¹ï?ï¼? *       ä½?kb_search ?ä¸º?¯å?æ­¥è??ç? in-container å·¥å…·ï¼›embedding ?ˆæ?ç´¢åœ¨å®¿ä¸» memory-kbï¼ˆsearchKbVectorï¼‰ã€? * ?³é”®å¯¼å‡ºï¼šregisterKbSearchTool, tokenizeKb, chunkKbText
 * ?¿é?ä¸å??ï??ªåœ¨ KB ?®å??…è¯»?–ï?resolve ?å?ç¼€?¡é?ï¼‰ï??‡ä»¶??æ·±åº¦ä¸Šé??²è?æºæ”¾å¤§ã€? *
 * ä¿®æ”¹è®°å?ï¼?026-08-14 ?›å»ºï¼ˆfix-planï¼škb_search ?¥å…¥ agentï¼? */
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

/** CJK è¿ç»­ä¸²å? bigramï¼Œlatin/?°å??´è?ï¼ˆä?å®¿ä¸» memory-kb.tokenize å¯¹é?ï¼?*/
export function tokenizeKb(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLowerCase().match(/[a-z0-9]+|[ä¸€-é¿¿\u3040-\u30ff]+/g) ?? []) {
    if (/^[a-z0-9]+$/.test(m) || m.length === 1) {
      out.push(m);
      continue;
    }
    for (let i = 0; i < m.length - 1; i++) out.push(m.slice(i, i + 2));
  }
  return out;
}

/** ?’å??†å?ï¼ˆæ??†é?ç¬¦ä??ˆçº§ï¼Œè?æ®µé?çº§ç??†é?ç¬¦ï? */
export function chunkKbText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP, seps = ["\n\n", "\n", "??, " "]): string[] {
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
  return process.env.OC_KB_DIR ?? join(getWorkspace(), "agent", "kb");
}

interface KbChunk {
  title: string;
  content: string;
  source: string;
  tokens: string[];
}

/** ?‰ç??å? KB ?®å??¶é? chunkï¼ˆé?æ·??æ?ä»¶æ•°/?å??‡ä»¶å¤§å?ï¼?*/
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
      // ?ªåœ¨ KB ?¹ç›®å½•å?ï¼ˆé˜²ç¬¦å·?¾æ¥/?¸å¯¹?ƒé€¸ï?
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
        "Search the group knowledge base (markdown/text files in the kb directory) and return the most relevant chunks with source citations. Use for factual questions answerable from the knowledge base. Returns empty hits when nothing is relevant ??then say you cannot answer from the KB.",
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
