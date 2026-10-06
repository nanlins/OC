/**
 * providers/claude.ts -- Anthropic Claude provider, host-side container contribution
 *
 * Responsibility: at spawn time, point the container at the host LLM proxy for the
 * Anthropic protocol. The real ANTHROPIC_API_KEY is injected by the proxy at the
 * network boundary and never enters the container environment.
 *
 * Key exports: none (side-effect registration of "claude")
 * Invariant: no credential in the returned env. This mirrors providers/openai.ts;
 *   the previous shape injected the real key via --env-file, which left the project
 *   with two contradictory key models (openai proxied, claude not) and meant a
 *   compromised container could read a live Anthropic key off its own environment.
 *   The container's Anthropic SDK sends a placeholder key; the proxy strips inbound
 *   credential headers and substitutes the host's (see src/llm-proxy.ts invariant 4).
 *
 * Referenced: nanoclaw src/providers/claude.ts (key-never-enters-container semantics)
 *
 * Modification record:
 *   2026-08-13  Created
 *   2026-10-06  P0-2: routed through the LLM proxy instead of injecting the real key,
 *               making the key model consistent across openai/claude/ollama
 */
import { proxyUrlFor } from "../llm-proxy.js";
import { registerProviderContainerConfig } from "./provider-container-registry.js";

registerProviderContainerConfig("claude", () => {
  const env: Record<string, string> = {};
  // The Anthropic SDK appends /v1/messages to this base, so the proxy sees
  // /llm-proxy-anthropic/v1/messages and forwards to the real api.anthropic.com.
  env.ANTHROPIC_BASE_URL = proxyUrlFor("anthropic");
  return { mounts: [], env };
});

/*
 * Modification record:
 *   2026-10-06  P0-2: proxy-only contribution; real key no longer injected into the container
 */
