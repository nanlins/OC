/**
 * install-slug.ts —— 每 checkout 安装标识（多安装共存作用域）
 *
 * 职责：sha1(projectRoot)[:8] 派生 slug → 容器 label/服务名/镜像名作用域隔离。
 * 关键导出：getInstallSlug, getContainerImageBase, getDefaultContainerImage
 * 借鉴：nanoclaw src/install-slug.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { createHash } from "node:crypto";

let cached: Map<string, string> = new Map();

export function getInstallSlug(projectRoot: string): string {
  const hit = cached.get(projectRoot);
  if (hit) return hit;
  const slug = createHash("sha1").update(projectRoot).digest("hex").slice(0, 8);
  cached.set(projectRoot, slug); // P2 修复：按 root 缓存（基线每次现算，缓存仅为性能）
  return slug;
}

export function getContainerImageBase(slug: string): string {
  return `openclaw-agent-${slug}`;
}

export function getDefaultContainerImage(slug: string): string {
  return `${getContainerImageBase(slug)}:latest`;
}

/** 仅供测试：重置缓存 */
export function resetInstallSlugCacheForTest(): void {
  cached = new Map();
}
