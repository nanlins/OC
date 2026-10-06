/**
 * cli-help.test.ts -- CLI parsing + help-render pure function unit tests.
 *
 * Responsibility: parseCmd token contract (single-token commands are legal) and
 * the three help layers (resource/verb/field) + usage rendering. Both are pure;
 * asserted without touching the registry, DB, or a socket.
 *
 * Modification record:
 *   2026-10-05  Created (oc help dead-code fix: lock parsing + three-layer contract)
 */
import { describe, expect, it } from "vitest";
import { parseCmd } from "../../src/cli/dispatch.js";
import {
  flagName,
  indent,
  listVerbs,
  renderCommandList,
  renderResourceHelp,
  renderUsage,
  renderVerbHelp,
  summaryLine,
  unknownCommandMessage,
  usageLine,
} from "../../src/cli/help-render.js";
import type { CommandDef } from "../../src/cli/registry.js";

describe("parseCmd: token contract", () => {
  it("accepts a single token as a resource with an empty verb (the oc help fix)", () => {
    expect(parseCmd("help")).toEqual({ resource: "help", verb: "", args: { flags: {}, positionals: [] } });
    expect(parseCmd("groups")?.resource).toBe("groups");
    expect(parseCmd("groups")?.verb).toBe("");
  });

  it("returns null only for a completely empty command", () => {
    expect(parseCmd("")).toBeNull();
    expect(parseCmd("   ")).toBeNull();
  });

  it("splits resource, verb, id, flags and extra positionals", () => {
    const p = parseCmd("groups create --name G --folder f extra1 extra2")!;
    expect(p.resource).toBe("groups");
    expect(p.verb).toBe("create");
    expect(p.args.flags).toEqual({ name: "G", folder: "f" });
    expect(p.args.id).toBe("extra1");
    expect(p.args.positionals).toEqual(["extra2"]);
  });

  it("treats a bare --flag as true and does not swallow the next flag as its value", () => {
    const p = parseCmd("groups create --help --name G")!;
    expect(p.args.flags.help).toBe("true");
    expect(p.args.flags.name).toBe("G");
  });

  it("takes the first positional as id", () => {
    expect(parseCmd("groups get abc123")?.args.id).toBe("abc123");
  });

  it("tolerates surrounding whitespace and repeated spaces", () => {
    const p = parseCmd("  groups    list  ")!;
    expect(p.resource).toBe("groups");
    expect(p.verb).toBe("list");
  });
});

const CMDS: CommandDef[] = [
  {
    resource: "groups",
    verb: "list",
    scope: "agent-group",
    agentVisible: true,
    description: "List agent groups.",
    handler: () => [],
  },
  {
    resource: "groups",
    verb: "create",
    scope: "host",
    description: "Create an agent group.\nSecond paragraph is dropped from summaries.",
    flags: [
      { name: "name", description: "Display name.", required: true },
      { name: "folder", description: "Workspace folder.", required: true },
      { name: "provider", description: "LLM provider.", enum: ["claude", "openai"] },
    ],
    handler: () => ({}),
  },
  {
    resource: "roles",
    verb: "grant",
    scope: "host",
    flags: [
      { name: "id", required: true },
      { name: "role", required: true, enum: ["owner", "admin"] },
    ],
    handler: () => ({}),
  },
];

describe("help-render: helpers", () => {
  it("flagName converts underscores to dashes", () => {
    expect(flagName("messaging_group")).toBe("--messaging-group");
    expect(flagName("name")).toBe("--name");
  });

  it("summaryLine keeps only the first paragraph", () => {
    expect(summaryLine("first\nsecond")).toBe("first");
    expect(summaryLine("")).toBe("");
  });

  it("indent pads non-empty lines only", () => {
    expect(indent("a\n\nb", "  ")).toBe("  a\n\n  b");
  });

  it("listVerbs returns sorted verbs for one resource", () => {
    expect(listVerbs(CMDS, "groups")).toEqual(["create", "list"]);
    expect(listVerbs(CMDS, "roles")).toEqual(["grant"]);
    expect(listVerbs(CMDS, "nope")).toEqual([]);
  });
});

describe("help-render: layer 1 (resource listing)", () => {
  it("renderCommandList groups verbs per resource and points at deeper layers", () => {
    const out = renderCommandList(CMDS);
    expect(out).toContain("OC CLI");
    expect(out).toContain("usage: oc <resource> <verb>");
    expect(out).toContain("groups");
    expect(out).toContain("create, list");
    expect(out).toContain("oc <resource> <verb> --help");
  });

  it("renderResourceHelp lists verbs with scope tags and descriptions", () => {
    const out = renderResourceHelp(CMDS, "groups");
    expect(out).toContain("oc groups");
    expect(out).toContain("Verbs:");
    expect(out).toContain("[host]");
    expect(out).toContain("[agent-group]");
    expect(out).toContain("List agent groups.");
    expect(out).toContain("oc groups <verb> --help");
  });

  it("renderResourceHelp on an unknown resource says so instead of rendering an empty page", () => {
    expect(renderResourceHelp(CMDS, "nope")).toContain("no commands registered for resource: nope");
  });
});

describe("help-render: layer 2/3 (verb + field)", () => {
  it("usageLine marks required flags bare and optional flags bracketed", () => {
    const create = CMDS.find((c) => c.verb === "create")!;
    const line = usageLine(create);
    expect(line).toContain("oc groups create");
    expect(line).toContain("--name <value>");
    expect(line).toContain("[--provider <value>]");
    expect(line).not.toContain("[--name");
  });

  it("renderVerbHelp shows description, scope, and every flag with constraints", () => {
    const create = CMDS.find((c) => c.verb === "create")!;
    const out = renderVerbHelp(create);
    expect(out).toContain("oc groups create");
    expect(out).toContain("Create an agent group.");
    expect(out).toContain("scope: host");
    expect(out).toContain("Flags:");
    expect(out).toContain("--name");
    expect(out).toContain("(required)");
    expect(out).toContain("values: claude | openai");
  });

  it("renderVerbHelp on a flag-less command falls back to a hint, not an empty section", () => {
    const list = CMDS.find((c) => c.verb === "list")!;
    const out = renderVerbHelp(list);
    expect(out).toContain("scope: agent-group, agent-visible");
    expect(out).toContain("none declared");
  });

  it("renderUsage degrades to a generic line when the command is unresolved", () => {
    expect(renderUsage(undefined, "nope", "nothing")).toBe("usage: oc nope nothing [id] [--flags]");
  });

  it("renderUsage for a resolved command lists its flags", () => {
    const grant = CMDS.find((c) => c.verb === "grant")!;
    const out = renderUsage(grant, "roles", "grant");
    expect(out).toContain("usage: oc roles grant");
    expect(out).toContain("--role");
    expect(out).toContain("values: owner | admin");
  });
});

describe("help-render: unknown-command message carries its fix", () => {
  it("known resource lists that resource's verbs", () => {
    const out = unknownCommandMessage(CMDS, "groups", "frobnicate");
    expect(out).toContain('no command "groups frobnicate"');
    expect(out).toContain("verbs for groups: create, list");
    expect(out).toContain("oc groups frobnicate --help");
  });

  it("unknown resource points at the top-level help", () => {
    const out = unknownCommandMessage(CMDS, "nope", "nothing");
    expect(out).toContain('no command "nope nothing"');
    expect(out).toContain("oc help");
    expect(out).not.toContain("verbs for");
  });
});

/*
 * Modification record:
 *   2026-10-05  Created (oc help dead-code fix: lock parsing + three-layer contract)
 */
