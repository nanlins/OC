/**
 * container-e2e.test.ts -- Docker availability gate for container end-to-end runs.
 *
 * Responsibility: verify a container runtime is actually usable before any test that
 * spawns an agent container is allowed to run. This is a GATE, not a full-chain test.
 *
 * Scope note (honesty fix, 2026-10-06): the header of this file used to claim it
 * verified "real container spawn + message polling end to end". It did not -- it only
 * probed `docker info`, and when the probe failed the test body `return`ed early, which
 * vitest records as a PASS. A vacuous pass is worse than a skip because it hides the
 * fact that nothing was exercised. Both problems are fixed here: the description says
 * what it does, and unmet preconditions report as skipped.
 *
 * A real spawn-and-reply E2E needs a live LLM credential and burns real tokens, so it
 * is deliberately NOT part of this suite; run it manually with OC_E2E=1 and a
 * configured .env once such a test exists.
 *
 * Modification record:
 *   2026-08-24  Created
 *   2026-10-06  Replaced vacuous early-return with it.skipIf; corrected the overclaiming
 *               header; added an explicit timeout on every docker invocation so a wedged
 *               daemon cannot hang the suite
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

const DOCKER_PROBE_TIMEOUT_MS = 8_000;

/**
 * Probe the runtime with a hard timeout. `docker info` is the right probe: it answers
 * quickly when the daemon is healthy and, unlike `docker ps -a` / `docker logs` /
 * `docker inspect`, it does not block on a wedged containerd shim lock.
 */
function probeDocker(): { available: boolean; version: string; reason: string } {
  try {
    const version = execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      encoding: "utf-8",
      timeout: DOCKER_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { available: version.length > 0, version, reason: "" };
  } catch (err) {
    const e = err as { code?: string; killed?: boolean; message?: string };
    const reason = e.killed
      ? `docker info timed out after ${DOCKER_PROBE_TIMEOUT_MS}ms (daemon may be wedged)`
      : (e.message ?? String(err));
    return { available: false, version: "", reason };
  }
}

const probe = probeDocker();
const e2eEnabled = process.env.OC_E2E === "1";
const canRun = probe.available && e2eEnabled;
const skipReason = !probe.available ? `docker unavailable: ${probe.reason}` : !e2eEnabled ? "OC_E2E=1 not set" : "";

describe.skipIf(!canRun)("container-e2e", () => {
  it("the container runtime answers a version probe", () => {
    expect(probe.version).toMatch(/^\d+\.\d+/);
  });

  it("the runtime can list running containers without hanging", () => {
    // `docker ps` (no -a) only enumerates running containers and does not touch the
    // state of stopped/created ones, so it stays responsive even when a shim is stuck.
    const out = execFileSync("docker", ["ps", "--format", "{{.ID}}"], {
      encoding: "utf-8",
      timeout: DOCKER_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(typeof out).toBe("string");
  });

  it("the OC agent image is present (run pnpm build:container first)", () => {
    const images = execFileSync("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}"], {
      encoding: "utf-8",
      timeout: DOCKER_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(images).toMatch(/oc-agent/);
  });
});

// Reported as an explicit skip so the suite output states why nothing ran.
describe("container-e2e preconditions", () => {
  it.skipIf(canRun)("are unmet, so the container suite is skipped", () => {
    expect(skipReason).not.toBe("");
  });
});

/*
 * Modification record:
 *   2026-08-24  Created
 *   2026-10-06  it.skipIf instead of vacuous pass; honest scope; docker probes time-boxed
 */
