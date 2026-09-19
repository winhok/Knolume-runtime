import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decideToolPermission } from "./permissions.js";
import type { ToolDefinition } from "./registry.js";

const definition: ToolDefinition = {
  name: "host_operation",
  description: "Provided by the host",
  inputSchema: z.object({}),
  capabilities: ["read"],
};

describe("generic permission defaults", () => {
  it("allows read capabilities and requires approval for side effects", () => {
    expect(decideToolPermission(definition, {}).level).toBe("allow");
    for (const capability of ["write", "execute", "external"] as const) {
      expect(decideToolPermission({ ...definition, capabilities: [capability] }, {}).level).toBe("ask");
    }
  });
});
