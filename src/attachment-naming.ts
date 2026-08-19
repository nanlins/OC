/**
 * attachment-naming.ts —— 无文件名附件的安全命名推导
 *
 * 职责：mimeType → 扩展名 → att.type 粗类；推导路径不可能构造穿越 payload。
 * 关键导出：extForMime, deriveAttachmentName
 * 借鉴：nanoclaw src/attachment-naming.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "application/zip": "zip",
};

export function extForMime(mime: string | undefined): string | null {
  if (!mime) return null;
  return MIME_EXT[mime.toLowerCase()] ?? null;
}

/** 推导安全文件名：优先清洗后的原名，否则 mime 扩展，否则类型粗类，兜底 bin */
export function deriveAttachmentName(opts: {
  name?: string | null;
  mime?: string | null;
  kind?: string | null;
}): string {
  const safe = (n: string) => n.replace(/[/\\\0]/g, "_").trim();
  if (opts.name) {
    const cleaned = safe(opts.name);
    if (cleaned && cleaned !== "." && cleaned !== "..") return cleaned;
  }
  const ext = extForMime(opts.mime ?? undefined) ?? (opts.kind ? safe(opts.kind) : null) ?? "bin";
  return `attachment.${ext}`;
}
