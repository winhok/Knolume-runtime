import { describe, expect, it } from "vitest";
import { pluginToolDiscoveryResponseSchema } from "./plugin-tools.js";

describe("pluginToolDiscoveryResponseSchema", () => {
  it("accepts typed Product-owned Tool metadata", () => {
    expect(
      pluginToolDiscoveryResponseSchema.parse({
        tools: [
          {
            name: "example__lookup",
            description: "Look up an example",
            inputSchema: { type: "object", properties: { query: { type: "string" } } },
            capabilities: ["read"],
            requiredResources: ["workspace"],
            isConcurrencySafe: true,
          },
        ],
      }).tools[0],
    ).toMatchObject({ name: "example__lookup", capabilities: ["read"] });
  });

  it("rejects duplicate names and unknown capabilities", () => {
    const tool = {
      name: "example__lookup",
      description: "Look up an example",
      inputSchema: { type: "object" },
      capabilities: ["read"],
    };
    expect(pluginToolDiscoveryResponseSchema.safeParse({ tools: [tool, tool] }).success).toBe(
      false,
    );
    expect(
      pluginToolDiscoveryResponseSchema.safeParse({
        tools: [{ ...tool, capabilities: ["root"] }],
      }).success,
    ).toBe(false);
  });
});
