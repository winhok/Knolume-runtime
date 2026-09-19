import { describe, expect, it } from "vitest";
import {
  agentsCapabilityResponseSchema,
  contextCapabilityRequestSchema,
  contextCapabilityResponseSchema,
  dreamCapabilityRequestSchema,
  hooksCapabilityResponseSchema,
  memoryCapabilityRequestSchema,
  memoryCapabilityResponseSchema,
  ragIngestRequestSchema,
} from "./product-capabilities.js";

describe("product capability contracts", () => {
  it("requires scoped memory search queries", () => {
    expect(
      memoryCapabilityRequestSchema.safeParse({
        userId: "user-1",
        sessionId: "session-1",
        operation: "search",
      }).success,
    ).toBe(false);
  });

  it("models RAG ingestion as a managed Workspace relative resource", () => {
    expect(
      ragIngestRequestSchema.parse({
        userId: "user-1",
        sessionId: "session-1",
        workspaceId: "ws_1",
        relativePath: "docs/spec.md",
      }),
    ).not.toHaveProperty("path");
    expect(
      ragIngestRequestSchema.safeParse({
        userId: "user-1",
        sessionId: "session-1",
        workspaceId: "ws_1",
        path: "/tmp/spec.md",
      }).success,
    ).toBe(false);
  });

  it("requires a Workspace for Memory lint and rejects host paths in lint outputs", () => {
    expect(
      memoryCapabilityRequestSchema.safeParse({
        userId: "user-1",
        sessionId: "session-1",
        operation: "lint",
      }).success,
    ).toBe(false);
    expect(
      memoryCapabilityResponseSchema.safeParse({
        entries: [],
        warnings: [],
        pathResults: [
          {
            filename: "project.md",
            relativePath: "/Users/name/project.ts",
            status: "exists",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires Dream to enter the durable Run protocol", () => {
    expect(
      dreamCapabilityRequestSchema.safeParse({
        userId: "user-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        clientRequestId: "dream-1",
      }).success,
    ).toBe(true);
  });

  it("binds Context diagnostics to an Agent and server-owned Execution Profile", () => {
    expect(
      contextCapabilityRequestSchema.safeParse({
        userId: "user-1",
        sessionId: "session-1",
      }).success,
    ).toBe(false);
    expect(
      contextCapabilityRequestSchema.safeParse({
        userId: "user-1",
        sessionId: "session-1",
        agentId: "example",
        executionProfileId: "example-readonly",
      }).success,
    ).toBe(true);
  });

  it("keeps unavailable provider measurements explicit in Context diagnostics", () => {
    const parsed = contextCapabilityResponseSchema.parse({
      agentId: "example",
      executionProfileId: "example-readonly",
      modelProfileId: "example-default",
      toolsetId: "example-readonly",
      allowedCapabilities: ["read", "state", "external"],
      model: {
        provider: "openai-compatible",
        modelId: null,
        nominalWindowTokens: null,
      },
      projection: {
        effectiveWindowTokens: 950_000,
        autocompactThresholdTokens: 200_000,
        usedTokens: 10,
        estimatedBreakdownTokens: 10,
        autocompactReserveTokens: 750_000,
        safetyReserveTokens: null,
        providerObservedPromptTokens: null,
        estimated: true,
        slices: [{ name: "Messages", tokens: 10, estimated: true }],
      },
      tools: {
        names: ["lookup_record", "mcp__docs__search"],
        activeNames: ["lookup_record"],
        deferredNames: ["mcp__docs__search"],
        descriptionTokens: 20,
        activeTokens: 20,
        deferredTokens: 10,
        totalTokens: 30,
        estimated: true,
      },
      resources: {
        workspaceBound: false,
        historyMessages: 1,
        memoryEntries: 0,
        ragEnabled: false,
        ragChunks: 0,
        ragSources: [],
        skills: 0,
      },
      renderedView: "context matrix",
    });

    expect(parsed.model.nominalWindowTokens).toBeNull();
    expect(parsed.projection.providerObservedPromptTokens).toBeNull();
    expect(parsed.projection.estimated).toBe(true);
    expect(parsed.tools.totalTokens).toBe(parsed.tools.activeTokens + parsed.tools.deferredTokens);
    expect(
      contextCapabilityResponseSchema.safeParse({
        ...parsed,
        tools: { ...parsed.tools, totalTokens: 31 },
      }).success,
    ).toBe(false);
  });

  it("describes delegation without pretending root-Run history is durable", () => {
    expect(
      agentsCapabilityResponseSchema.safeParse({
        agentId: "example",
        executionProfileId: "example-readonly",
        delegation: { enabled: false },
        profiles: [],
        recentRuns: [],
        runHistoryAvailable: true,
      }).success,
    ).toBe(true);
  });

  it("exposes only registered Hook names across the Product boundary", () => {
    expect(
      hooksCapabilityResponseSchema.parse({
        pre: ["audit-log"],
        post: ["external_action-timestamp"],
      }),
    ).toEqual({ pre: ["audit-log"], post: ["external_action-timestamp"] });
  });
});
