/**
 * attachment-inbox-safety.test.ts —— 附件/收件箱安全单元测试
 *
 * 职责：附件名判定/命名推导/inbox 四层防御（预置符号链接拒绝）。
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSafeAttachmentName } from "../../src/attachment-safety.js";
import { deriveAttachmentName, extForMime } from "../../src/attachment-naming.js";
import { ensureContainedInboxDir, isPathInside } from "../../src/inbox-safety.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-inbox-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("attachment safety", () => {
  it("rejects traversal, dots, NUL, separators, drive prefixes", () => {
    expect(isSafeAttachmentName("../../etc/passwd")).toBe(false);
    expect(isSafeAttachmentName("..")).toBe(false);
    expect(isSafeAttachmentName(".")).toBe(false);
    expect(isSafeAttachmentName("a\0b.png")).toBe(false);
    expect(isSafeAttachmentName("a/b.png")).toBe(false);
    expect(isSafeAttachmentName("C:evil.txt")).toBe(false);
    expect(isSafeAttachmentName("photo.png")).toBe(true);
  });

  it("derives names from mime with fallbacks", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(deriveAttachmentName({ name: null, mime: "application/pdf" })).toBe("attachment.pdf");
    expect(deriveAttachmentName({ name: "report final.pdf", mime: null })).toBe("report final.pdf");
    expect(deriveAttachmentName({ name: "../../x", mime: null, kind: "image" })).toMatch(/attachment|_/);
  });
});

describe("inbox safety", () => {
  it("isPathInside containment", () => {
    expect(isPathInside(dir, join(dir, "a", "b"))).toBe(true);
    expect(isPathInside(dir, join(dir, "..", "evil"))).toBe(false);
  });

  it("creates contained inbox dir", () => {
    const got = ensureContainedInboxDir(dir, "msg-1", "test");
    expect(got).toBe(join(dir, "msg-1"));
    expect(existsSync(got!)).toBe(true);
  });

  it("refuses pre-existing symlinked inbox dir", () => {
    const outside = mkdtempSync(join(tmpdir(), "oc-evil-"));
    symlinkSync(outside, join(dir, "msg-2"));
    const got = ensureContainedInboxDir(dir, "msg-2", "test");
    expect(got).toBeNull();
    rmSync(outside, { recursive: true, force: true });
  });

  it("refuses symlinked inbox root", () => {
    const outside = mkdtempSync(join(tmpdir(), "oc-evil2-"));
    const rootLink = join(dir, "rootlink");
    symlinkSync(outside, rootLink);
    const got = ensureContainedInboxDir(rootLink, "m", "test");
    expect(got).toBeNull();
    rmSync(outside, { recursive: true, force: true });
  });

  it("mkdirs missing root then contains", () => {
    const nested = join(dir, "nope", "yet");
    const got = ensureContainedInboxDir(nested, "m1", "test");
    expect(got).toBe(join(nested, "m1"));
    mkdirSync(got!, { recursive: true });
  });
});
