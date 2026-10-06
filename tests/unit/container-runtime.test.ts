/**
 * container-runtime.test.ts -- runtime binary resolution unit tests (P2-2).
 *
 * Responsibility: pin resolveRuntimeBin's allowlist and shape validation. The binary
 * name is the one piece of the container command line that comes from configuration
 * rather than from code, so it is validated instead of trusted.
 *
 * Modification record:
 *   2026-10-06  Created (P2-2)
 */
import { describe, expect, it } from "vitest";
import { resolveRuntimeBin, CONTAINER_NAME_RE } from "../../src/container-runtime.js";

describe("resolveRuntimeBin", () => {
  it("defaults to docker when unset or blank", () => {
    expect(resolveRuntimeBin(undefined)).toBe("docker");
    expect(resolveRuntimeBin("")).toBe("docker");
    expect(resolveRuntimeBin("   ")).toBe("docker");
  });

  it("accepts the two allowlisted runtimes", () => {
    expect(resolveRuntimeBin("docker")).toBe("docker");
    expect(resolveRuntimeBin("podman")).toBe("podman");
  });

  it("accepts an explicit path whose basename is allowlisted", () => {
    expect(resolveRuntimeBin("/usr/local/bin/docker")).toBe("/usr/local/bin/docker");
    expect(resolveRuntimeBin("/usr/bin/podman")).toBe("/usr/bin/podman");
  });

  it("accepts a Windows path containing spaces and an .exe suffix", () => {
    const win = "C:\\Program Files\\Docker\\docker.exe";
    expect(resolveRuntimeBin(win)).toBe(win);
  });

  it("refuses a binary outside the allowlist and falls back to docker", () => {
    for (const bad of ["rm", "sh", "bash", "evil", "docker-wrapper", "podman-remote"]) {
      expect(resolveRuntimeBin(bad), bad).toBe("docker");
    }
  });

  it("refuses shell metacharacters even when an allowlisted name is embedded", () => {
    for (const bad of [
      "docker; rm -rf /",
      "docker && curl evil",
      "docker | sh",
      "$(docker)",
      "docker`id`",
      "docker\n--privileged",
    ]) {
      expect(resolveRuntimeBin(bad), bad).toBe("docker");
    }
  });

  it("refuses a path traversal that ends in an allowlisted name", () => {
    // basename is docker, but the value carries a redirection character
    expect(resolveRuntimeBin("docker>out")).toBe("docker");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(resolveRuntimeBin("  podman  ")).toBe("podman");
  });
});

describe("CONTAINER_NAME_RE", () => {
  it("accepts docker-legal names", () => {
    expect(CONTAINER_NAME_RE.test("oc-abc123")).toBe(true);
    expect(CONTAINER_NAME_RE.test("a")).toBe(true);
  });

  it("rejects names that could carry an argument or a flag", () => {
    for (const bad of ["-x", "--privileged", "a b", "a;b", "a|b", "a`b", "a$b", ""]) {
      expect(CONTAINER_NAME_RE.test(bad), bad).toBe(false);
    }
  });
});

/*
 * Modification record:
 *   2026-10-06  Created (P2-2)
 */
