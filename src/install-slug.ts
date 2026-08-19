/**
 * install-slug.ts ?”â€?æ¯?checkout å®‰è??‡è?ï¼ˆå?å®‰è??±å?ä½œç”¨?Ÿï?
 *
 * ?Œè´£ï¼šsha1(projectRoot)[:8] æ´¾ç? slug ??å®¹å™¨ label/?åŠ¡???œå??ä??¨å??”ç¦»?? * ?³é”®å¯¼å‡ºï¼šgetInstallSlug, getContainerImageBase, getDefaultContainerImage
 * ?Ÿé‰´ï¼šnanoclaw src/install-slug.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?2ï¼? */
import { createHash } from "node:crypto";

let cached: Map<string, string> = new Map();

export function getInstallSlug(projectRoot: string): string {
  const hit = cached.get(projectRoot);
  if (hit) return hit;
  const slug = createHash("sha1").update(projectRoot).digest("hex").slice(0, 8);
  cached.set(projectRoot, slug); // P2 ä¿®å?ï¼šæ? root ç¼“å?ï¼ˆåŸºçº¿æ?æ¬¡ç°ç®—ï?ç¼“å?ä»…ä¸º?§èƒ½ï¼?  return slug;
}

export function getContainerImageBase(slug: string): string {
  return `OC-agent-${slug}`;
}

export function getDefaultContainerImage(slug: string): string {
  return `${getContainerImageBase(slug)}:latest`;
}

/** ä»…ä?æµ‹è?ï¼šé?ç½®ç?å­?*/
export function resetInstallSlugCacheForTest(): void {
  cached = new Map();
}
