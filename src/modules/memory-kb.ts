/**
 * modules/memory-kb.ts —— 知识库（RAG）扩展模块（知识文档 03 落地）
 *
 * 职责：模块迁移建表（kb_documents/kb_chunks）；递归分块（400/overlap 60）；
 *       BM25-lite 检索（term 重叠打分，无外部 embedding 依赖；pgvector 后端接口预留 P2）；
 *       阈值拒答（score<min 返回空 → 调用方拒答）。
 * 关键导出：chunkText, addDocument, searchKb, MIN_SCORE
 * 核心模式：模块迁移命名空间 module:memory-kb:*；hasTable 降级。
 * 借鉴：知识文档 03（分块/召回/阈值拒答）；nanoclaw 无 RAG（自主扩展）。
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 */
import { getDb } from "../db/connection.js";
import { registerMigration } from "../db/migrations/index.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

registerMigration({
  version: 900,
  name: "module:memory-kb:tables",
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_documents (
        id TEXT PRIMARY KEY,
        kb TEXT NOT NULL,
        title TEXT NOT NULL,
        source TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kb_chunks (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        content TEXT NOT NULL,
        tokens TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_id);
    `);
  },
});

export const CHUNK_SIZE = 400;
export const CHUNK_OVERLAP = 60;
export const MIN_SCORE = 0.05;

/** 递归分块（按分隔符优先级，超大段降级用细分隔符复切，知识文档 03 §3.2） */
export function chunkText(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
  seps: string[] = ["\n\n", "\n", "。", " "],
): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= size) return [t];
  const sep = seps.find((s) => s !== "" && t.includes(s));
  if (!sep) return hardSplit(t, size, overlap);
  const rest = seps.slice(seps.indexOf(sep) + 1);
  const parts = t.split(sep);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    const piece = p + sep;
    if (cur.length + piece.length > size && cur) {
      out.push(...chunkText(cur.trim(), size, overlap, rest));
      cur = overlap ? cur.slice(-overlap) : "";
    }
    cur += piece;
  }
  if (cur.trim()) out.push(...chunkText(cur.trim(), size, overlap, rest));
  return out.filter(Boolean);
}

/** 字符级硬切 + overlap（最后兜底） */
function hardSplit(t: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < t.length; i += Math.max(1, size - overlap)) {
    out.push(t.slice(i, i + size));
  }
  return out.filter(Boolean);
}

/** CJK 连续串切 bigram（改写鲁棒），latin/数字整词；并入日文假名区 U+3040–U+30FF（阶段 14 ai-inspector P1-2 修复） */
export function tokenize(s: string): string[] {
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

export function addDocument(kb: string, title: string, text: string, source?: string): string {
  const db = getDb();
  const docId = randomUUID();
  db.prepare("INSERT INTO kb_documents (id, kb, title, source, created_at) VALUES (?, ?, ?, ?, ?)").run(
    docId,
    kb,
    title,
    source ?? null,
    new Date().toISOString(),
  );
  const chunks = chunkText(text);
  const stmt = db.prepare("INSERT INTO kb_chunks (id, doc_id, seq, content, tokens) VALUES (?, ?, ?, ?, ?)");
  chunks.forEach((c, i) => {
    stmt.run(randomUUID(), docId, i, c, JSON.stringify(tokenize(c)));
  });
  return docId;
}

export interface KbHit {
  title: string;
  content: string;
  score: number;
  /** 引用溯源（知识文档 03 §3.8）：来源 + 块序号可回链 */
  source: string | null;
  chunkSeq: number;
}

/** BM25-lite：query terms 在 chunk tokens 中的覆盖率打分；低于 MIN_SCORE 拒答（返回空） */
export function searchKb(kb: string, query: string, k = 4): KbHit[] {
  const db = getDb();
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT c.content, c.tokens, c.seq, d.title, d.source FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id WHERE d.kb = ?`,
    )
    .all(kb) as Array<{ content: string; tokens: string; seq: number; title: string; source: string | null }>;
  const scored: KbHit[] = rows.map((r) => {
    const toks = JSON.parse(r.tokens) as string[];
    const tokSet = new Set(toks);
    let hit = 0;
    for (const q of qTokens) {
      // bigram 相等为主，子串包含兜底（单字符/latin）
      if (tokSet.has(q) || toks.some((t) => t.includes(q) || q.includes(t))) hit += 1;
    }
    const score = hit / qTokens.length;
    return { title: r.title, content: r.content, score, source: r.source, chunkSeq: r.seq };
  });
  return scored
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---- 向量检索（fix-plan：RAG embedding；可注入 embedder，无 embedder 时回退关键词） ----

registerMigration({
  version: 901,
  name: "module:memory-kb:embeddings",
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_embeddings (
        chunk_id TEXT PRIMARY KEY REFERENCES kb_chunks(id) ON DELETE CASCADE,
        vector   TEXT NOT NULL
      );
    `);
  },
});

/** 嵌入函数（可注入：生产接 embedding API，测试用确定性假向量） */
export type EmbedFn = (text: string) => Promise<number[]>;
let embedder: EmbedFn | null = null;
export function setEmbedder(fn: EmbedFn | null): void {
  embedder = fn;
}
/** 向量检索最低相似度（低于视为不相关 → 拒答） */
export const MIN_VECTOR_SCORE = 0.25;

/** 写入文档并（若已配置 embedder）为每个 chunk 计算并存储向量 */
export async function indexDocument(kb: string, title: string, text: string, source?: string): Promise<string> {
  const docId = addDocument(kb, title, text, source);
  if (!embedder) return docId;
  const db = getDb();
  const chunks = db.prepare("SELECT id, content FROM kb_chunks WHERE doc_id = ?").all(docId) as Array<{
    id: string;
    content: string;
  }>;
  const ins = db.prepare("INSERT OR REPLACE INTO kb_embeddings (chunk_id, vector) VALUES (?, ?)");
  for (const c of chunks) {
    const vec = await embedder(c.content);
    ins.run(c.id, JSON.stringify(vec));
  }
  return docId;
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 向量检索：嵌入 query → 与 chunk 向量余弦相似度 → 阈值过滤 + top-k。
 * 未配置 embedder 或无向量时回退关键词 searchKb（保证可用）。
 */
export async function searchKbVector(kb: string, query: string, k = 4): Promise<KbHit[]> {
  if (!embedder) return searchKb(kb, query, k);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.content, c.tokens, c.seq, d.title, d.source, e.vector
       FROM kb_chunks c
       JOIN kb_documents d ON d.id = c.doc_id
       JOIN kb_embeddings e ON e.chunk_id = c.id
       WHERE d.kb = ?`,
    )
    .all(kb) as Array<{
    content: string;
    tokens: string;
    seq: number;
    title: string;
    source: string | null;
    vector: string;
  }>;
  if (rows.length === 0) return searchKb(kb, query, k);
  const qv = await embedder(query);
  const scored: KbHit[] = rows.map((r) => ({
    title: r.title,
    content: r.content,
    score: cosine(qv, JSON.parse(r.vector) as number[]),
    source: r.source,
    chunkSeq: r.seq,
  }));
  return scored
    .filter((s) => s.score >= MIN_VECTOR_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---- 宿主→容器 KB 同步（fix-plan：宿主 memory-kb 与容器 kb_search 打通） ----

/** 文件名安全化（去路径分隔符与非法字符） */
function safeFileName(title: string): string {
  const s = title.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return (s || "untitled").slice(0, 120);
}

/**
 * 把 KB 的文档物化为 markdown 文件写入 targetDir（供容器 kb_search 读取，实现宿主/容器 KB 同步）。
 * 每个文档按 chunk 顺序拼回一个 .md（分块 overlap 会带少量重复，kb_search 会重新分块，影响轻微）。
 * 先清空 targetDir 内既有 md/txt，避免已删文档残留。返回写出的文档数。
 */
export function exportKbToDir(kb: string, targetDir: string): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT d.id AS doc_id, d.title, d.source, c.content, c.seq
       FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
       WHERE d.kb = ? ORDER BY d.id, c.seq`,
    )
    .all(kb) as Array<{ doc_id: string; title: string; source: string | null; content: string; seq: number }>;
  if (rows.length === 0) return 0; // 空 KB 不清理目标目录（避免误删手工维护的 kb/）
  mkdirSync(targetDir, { recursive: true });
  try {
    for (const f of readdirSync(targetDir)) {
      if (/\.(md|txt|markdown)$/i.test(f)) rmSync(join(targetDir, f), { force: true });
    }
  } catch {
    /* 目录不可读则跳过清理 */
  }
  const byDoc = new Map<string, { title: string; source: string | null; parts: string[] }>();
  for (const r of rows) {
    const cur = byDoc.get(r.doc_id) ?? { title: r.title, source: r.source, parts: [] };
    cur.parts.push(r.content);
    byDoc.set(r.doc_id, cur);
  }
  let n = 0;
  for (const { title, source, parts } of byDoc.values()) {
    const header = source ? `<!-- source: ${source} -->\n` : "";
    writeFileSync(join(targetDir, `${safeFileName(title)}.md`), `${header}# ${title}\n\n${parts.join("\n\n")}\n`);
    n += 1;
  }
  return n;
}
