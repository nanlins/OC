/**
 * llm-proxy.test.ts -- LLM key proxy security boundary unit tests (P0-2).
 *
 * Responsibility: pin the three security properties of src/llm-proxy.ts --
 * peer CIDR allowlist, upstream URL resolution that a request path cannot redirect,
 * and profile/prefix matching. Pure functions only: no socket is opened and no real
 * credential is read (fake keys are passed in explicitly, so nothing can leak into
 * a snapshot or the test log).
 *
 * Modification record:
 *   2026-10-06  Created (P0-2)
 */
import { describe, expect, it } from "vitest";
import {
  isTrustedPeer,
  matchProfile,
  parseTrustedCidrs,
  proxyUrlFor,
  resolveUpstream,
  type ProxyCreds,
} from "../../src/llm-proxy.js";

const CREDS: ProxyCreds = {
  openai: { apiKey: "fake-openai-key", baseUrl: "https://api.deepseek.com/v1" },
  anthropic: { apiKey: "fake-anthropic-key", baseUrl: "https://api.anthropic.com" },
};

describe("llm-proxy: peer allowlist", () => {
  it("trusts loopback in both families and the ipv4-mapped form", () => {
    expect(isTrustedPeer("127.0.0.1")).toBe(true);
    expect(isTrustedPeer("127.5.6.7")).toBe(true);
    expect(isTrustedPeer("::1")).toBe(true);
    expect(isTrustedPeer("::ffff:127.0.0.1")).toBe(true);
  });

  it("trusts the docker default bridge but NOT the whole 172.16/12", () => {
    const cidrs = parseTrustedCidrs("127.0.0.0/8,172.17.0.0/16,192.168.65.0/24");
    expect(isTrustedPeer("172.17.0.5", cidrs)).toBe(true);
    expect(isTrustedPeer("192.168.65.2", cidrs)).toBe(true);
    // The regression this guards: 172.20.x.x is inside 172.16/12 (the old blanket
    // trust) but is NOT Docker's bridge -- it is some other private network.
    expect(isTrustedPeer("172.20.0.1", cidrs)).toBe(false);
    expect(isTrustedPeer("172.16.0.1", cidrs)).toBe(false);
    expect(isTrustedPeer("172.31.255.254", cidrs)).toBe(false);
  });

  it("rejects public and unrelated private addresses", () => {
    const cidrs = parseTrustedCidrs("127.0.0.0/8,172.17.0.0/16");
    for (const ip of ["8.8.8.8", "1.1.1.1", "10.0.0.5", "192.168.1.50", "192.168.65.9"]) {
      expect(isTrustedPeer(ip, cidrs)).toBe(false);
    }
  });

  it("rejects malformed, empty and non-loopback ipv6 input", () => {
    const cidrs = parseTrustedCidrs("127.0.0.0/8");
    expect(isTrustedPeer(undefined, cidrs)).toBe(false);
    expect(isTrustedPeer("", cidrs)).toBe(false);
    expect(isTrustedPeer("not-an-ip", cidrs)).toBe(false);
    expect(isTrustedPeer("127.0.0.999", cidrs)).toBe(false);
    expect(isTrustedPeer("fe80::1", cidrs)).toBe(false);
    expect(isTrustedPeer("2001:db8::1", cidrs)).toBe(false);
  });

  it("drops malformed CIDR entries instead of widening trust", () => {
    expect(parseTrustedCidrs("")).toEqual([]);
    expect(parseTrustedCidrs("garbage,10.0.0.0/8,999.1.1.1/8,1.2.3.4/99")).toHaveLength(1);
    // A bare IP with no prefix length is a /32 host route.
    const host = parseTrustedCidrs("172.17.0.5");
    expect(isTrustedPeer("172.17.0.5", host)).toBe(true);
    expect(isTrustedPeer("172.17.0.6", host)).toBe(false);
  });

  it("honours an operator-supplied extra subnet (compose networks)", () => {
    const cidrs = parseTrustedCidrs("127.0.0.0/8,172.18.0.0/16");
    expect(isTrustedPeer("172.18.0.9", cidrs)).toBe(true);
    expect(isTrustedPeer("172.17.0.9", cidrs)).toBe(false);
  });
});

describe("llm-proxy: profile matching", () => {
  it("matches the longest prefix so anthropic is not swallowed by the openai prefix", () => {
    expect(matchProfile("/llm-proxy-anthropic/v1/messages")?.profile).toBe("anthropic");
    expect(matchProfile("/llm-proxy/chat/completions")?.profile).toBe("openai");
  });

  it("keeps the remainder path and query", () => {
    expect(matchProfile("/llm-proxy/chat/completions?stream=1")).toMatchObject({
      profile: "openai",
      remainder: "/chat/completions?stream=1",
    });
    expect(matchProfile("/llm-proxy-anthropic/v1/messages")?.remainder).toBe("/v1/messages");
  });

  it("defaults a bare prefix to /", () => {
    expect(matchProfile("/llm-proxy")?.remainder).toBe("/");
  });

  it("returns null for a non-proxy path", () => {
    expect(matchProfile("/")).toBeNull();
    expect(matchProfile("/something-else")).toBeNull();
    expect(matchProfile("/llm-proxyfoo/bar")).toBeNull();
  });

  it("proxyUrlFor builds the container-facing address per profile", () => {
    expect(proxyUrlFor("openai")).toContain("/llm-proxy");
    expect(proxyUrlFor("anthropic")).toContain("/llm-proxy-anthropic");
    expect(proxyUrlFor("anthropic")).not.toBe(proxyUrlFor("openai"));
    expect(proxyUrlFor("openai", "172.17.0.1")).toContain("172.17.0.1");
  });
});

describe("llm-proxy: upstream resolution", () => {
  it("preserves the base path (DeepSeek's /v1) instead of dropping it", () => {
    const r = resolveUpstream("openai", "/llm-proxy/chat/completions", CREDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hostname).toBe("api.deepseek.com");
    expect(r.path).toBe("/v1/chat/completions");
    expect(r.isHttps).toBe(true);
    expect(r.authHeader).toBe("authorization");
  });

  it("resolves the anthropic profile to x-api-key against api.anthropic.com", () => {
    const r = resolveUpstream("anthropic", "/llm-proxy-anthropic/v1/messages", CREDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hostname).toBe("api.anthropic.com");
    expect(r.path).toBe("/v1/messages");
    expect(r.authHeader).toBe("x-api-key");
    expect(r.apiKey).toBe("fake-anthropic-key");
  });

  it("carries the query string through", () => {
    const r = resolveUpstream("openai", "/llm-proxy/models?limit=2", CREDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path).toBe("/v1/models?limit=2");
  });

  it("refuses a protocol-relative path that would rewrite the hostname", () => {
    for (const url of [
      "/llm-proxy//evil.example.com/steal",
      "/llm-proxy/\\\\evil.example.com/steal",
      "/llm-proxy/\\evil.example.com",
    ]) {
      const r = resolveUpstream("openai", url, CREDS);
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/protocol-relative|backslash/);
    }
  });

  it("refuses path traversal that would escape the configured base path", () => {
    const r = resolveUpstream("openai", "/llm-proxy/../..%2fadmin", CREDS);
    // The encoded form survives as a literal segment; the raw ".." form is refused outright.
    const raw = resolveUpstream("openai", "/llm-proxy/../../admin", CREDS);
    expect(raw.ok).toBe(false);
    if (!raw.ok) expect(raw.reason).toContain("traversal");
    // Even if a variant slipped past the segment check, the host backstop must hold.
    if (r.ok) expect(r.hostname).toBe("api.deepseek.com");
  });

  it("never resolves to a host other than the configured base", () => {
    const attempts = [
      "/llm-proxy@evil.example.com/",
      "/llm-proxy/redirect?next=https://evil.example.com",
      "/llm-proxy/%2f%2fevil.example.com",
    ];
    for (const url of attempts) {
      const r = resolveUpstream("openai", url, CREDS);
      if (r.ok) expect(r.hostname, url).toBe("api.deepseek.com");
    }
  });

  it("reports a missing host key rather than forwarding an unauthenticated request", () => {
    const noKey: ProxyCreds = { openai: null, anthropic: null };
    const r = resolveUpstream("openai", "/llm-proxy/chat/completions", noKey);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("OPENAI_API_KEY");
  });

  it("rejects a non-http(s) base URL", () => {
    const bad: ProxyCreds = {
      openai: { apiKey: "k", baseUrl: "file:///etc/passwd" },
      anthropic: null,
    };
    const r = resolveUpstream("openai", "/llm-proxy/x", bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("protocol");
  });

  it("rejects an unparseable base URL", () => {
    const bad: ProxyCreds = { openai: { apiKey: "k", baseUrl: "not a url" }, anthropic: null };
    const r = resolveUpstream("openai", "/llm-proxy/x", bad);
    expect(r.ok).toBe(false);
  });

  it("rejects a request whose profile does not match the resolved prefix", () => {
    const r = resolveUpstream("anthropic", "/llm-proxy/chat/completions", CREDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not a proxy path");
  });

  it("derives the default port from the scheme", () => {
    const https = resolveUpstream("openai", "/llm-proxy/x", CREDS);
    expect(https.ok && https.port).toBe("443");
    const http: ProxyCreds = {
      openai: { apiKey: "k", baseUrl: "http://127.0.0.1:11434/v1" },
      anthropic: null,
    };
    const r = resolveUpstream("openai", "/llm-proxy/x", http);
    expect(r.ok && r.port).toBe("11434");
  });
});

/*
 * Modification record:
 *   2026-10-06  Created (P0-2)
 */
