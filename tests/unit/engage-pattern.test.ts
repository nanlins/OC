/**
 * engage-pattern.test.ts -- router engage evaluation unit tests (P0-3).
 *
 * Responsibility: pin evaluateEngage's fail-CLOSED behaviour on an uncompilable
 * engage_pattern. The previous implementation returned true, which meant one bad
 * regex made every inbound message engage the agent -- burning tokens and silently
 * overriding the operator's engage intent.
 *
 * Only the pattern/mention/default branches are exercised here; mention-sticky needs
 * a DB and is covered by tests/integration/router.test.ts.
 *
 * Modification record:
 *   2026-10-06  Created (P0-3)
 */
import { describe, expect, it } from "vitest";
import { evaluateEngage } from "../../src/router.js";
import type { MessagingGroup, MessagingGroupAgent } from "../../src/types.js";
import type { InboundEvent } from "../../src/channels/adapter.js";

function wiring(engageMode: string, engagePattern: string | null): MessagingGroupAgent {
  return { engage_mode: engageMode, engage_pattern: engagePattern } as MessagingGroupAgent;
}

function event(content: string, isMention = false): InboundEvent {
  return {
    channelType: "mock",
    platformId: "p1",
    threadId: null,
    message: { id: "m1", kind: "chat", content, timestamp: new Date().toISOString(), isMention },
  } as InboundEvent;
}

const MG = { id: "mg1", is_group: 0 } as MessagingGroup;

describe("evaluateEngage: pattern mode", () => {
  it("engages when the pattern matches", () => {
    expect(evaluateEngage(wiring("pattern", "^hello"), event("hello world"), MG, null)).toBe(true);
  });

  it("does not engage when the pattern does not match", () => {
    expect(evaluateEngage(wiring("pattern", "^hello"), event("goodbye"), MG, null)).toBe(false);
  });

  it("falls back to '.' (match anything) when no pattern is stored", () => {
    expect(evaluateEngage(wiring("pattern", null), event("anything at all"), MG, null)).toBe(true);
  });

  it("fails CLOSED on an uncompilable regex (P0-3 regression)", () => {
    for (const bad of ["[", "(", "unclosed[bracket", "*bad", "a{2,1}", "(?<"]) {
      expect(evaluateEngage(wiring("pattern", bad), event("hello"), MG, null), bad).toBe(false);
    }
  });

  it("fails closed on a bad regex even when the message would otherwise match", () => {
    // The old code returned true here for EVERY message; the content is irrelevant now.
    expect(evaluateEngage(wiring("pattern", "["), event("["), MG, null)).toBe(false);
    expect(evaluateEngage(wiring("pattern", "("), event("anything"), MG, null)).toBe(false);
  });
});

describe("evaluateEngage: mention mode", () => {
  it("engages only on a platform-confirmed mention", () => {
    expect(evaluateEngage(wiring("mention", null), event("hi", true), MG, null)).toBe(true);
    expect(evaluateEngage(wiring("mention", null), event("hi", false), MG, null)).toBe(false);
    expect(evaluateEngage(wiring("mention", null), event("hi"), MG, null)).toBe(false);
  });

  it("never falls back to text matching for mentions", () => {
    // "@bot" in the text is not a mention signal; only the platform flag counts.
    expect(evaluateEngage(wiring("mention", null), event("@bot help", false), MG, null)).toBe(false);
  });
});

describe("evaluateEngage: unknown mode", () => {
  it("fails closed on an unrecognised engage_mode", () => {
    expect(evaluateEngage(wiring("bogus", null), event("hi", true), MG, null)).toBe(false);
    expect(evaluateEngage(wiring("", null), event("hi", true), MG, null)).toBe(false);
  });
});

/*
 * Modification record:
 *   2026-10-06  Created (P0-3)
 */
