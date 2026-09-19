import type { PluginToolDescriptor } from "../protocol/index.js";
import { describe, expect, it } from "vitest";
import { createProductToolDefinitions } from "./product-tools.js";

describe("createProductToolDefinitions", () => {
  it("preserves Product-declared policy metadata without applying MCP names", () => {
    const descriptor: PluginToolDescriptor = {
      name: "review__publish",
      description: "Publish a review",
      inputSchema: { type: "object", properties: { body: { type: "string" } } },
      capabilities: ["write", "external"],
      requiredResources: ["workspace"],
      isConcurrencySafe: false,
      holdsExecutionLock: true,
      maxResultChars: 2_000,
    };

    expect(createProductToolDefinitions([descriptor])).toEqual([
      expect.objectContaining({
        name: "review__publish",
        inputJsonSchema: descriptor.inputSchema,
        capabilities: ["write", "external"],
        requiredResources: ["workspace"],
      }),
    ]);
  });
});
