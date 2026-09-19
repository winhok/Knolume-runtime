import { describe, expect, it } from "vitest";
import { resolveSubAgentProfile } from "./profiles.js";
import type { SubAgentProfile } from "./types.js";

const profiles: Record<string, SubAgentProfile> = {
  general: {
    description: "general",
    systemPrompt: "general",
    capabilities: ["read", "write", "delegate"],
  },
  explorer: {
    description: "explorer",
    systemPrompt: "explorer",
    capabilities: ["read"],
  },
  custom: {
    description: "custom",
    systemPrompt: "custom",
    capabilities: ["read", "write"],
    tools: ["lookup_record", "update_record"],
  },
};

describe("resolveSubAgentProfile", () => {
  it("resolves configurable profiles and only narrows requested tool scope", () => {
    const resolved = resolveSubAgentProfile(
      { task: "edit", profile: "custom", tools: ["lookup_record", "external_action"] },
      profiles,
    );

    expect(resolved.name).toBe("custom");
    expect([...(resolved.selection.allowedTools ?? [])]).toEqual(["lookup_record"]);
    expect(resolved.selection.allowedCapabilities?.has("write")).toBe(true);
    expect(resolved.selection.deniedCapabilities?.has("delegate")).toBe(true);
  });

  it("forces parallel tasks through the read-only execution policy", () => {
    const resolved = resolveSubAgentProfile(
      { task: "compare", profile: "general" },
      profiles,
      true,
    );

    expect(resolved.selection.readOnlyOnly).toBe(true);
    expect(resolved.selection.deniedCapabilities?.has("delegate")).toBe(true);
  });

  it("defaults sequential and parallel requests to distinct profiles", () => {
    expect(resolveSubAgentProfile({ task: "work" }, profiles).name).toBe("general");
    expect(resolveSubAgentProfile({ task: "inspect" }, profiles, true).name).toBe("explorer");
  });

  it("rejects unknown profile names", () => {
    expect(() => resolveSubAgentProfile({ task: "work", profile: "missing" }, profiles)).toThrow(
      "未知子 Agent Profile",
    );
  });
});
