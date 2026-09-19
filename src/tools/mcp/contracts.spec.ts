import { describe, expect, it, vi } from "vitest";
import { createMcpToolDefinitions, type McpToolClientPort } from "./contracts.js";

describe("createMcpToolDefinitions", () => {
  it("preserves the provider schema and delegates execution to the original tool name", async () => {
    const client: McpToolClientPort = {
      connect: vi.fn(),
      listTools: vi.fn(),
      callTool: vi.fn().mockResolvedValue("ok"),
      close: vi.fn(),
    };
    const [definition] = createMcpToolDefinitions(
      "github",
      [
        {
          name: "list_issues",
          description: "List issues",
          inputSchema: { type: "object", properties: { state: { type: "string" } } },
        },
      ],
      client,
    );

    expect(definition).toMatchObject({
      name: "mcp__github__list_issues",
      shouldDefer: true,
      capabilities: ["external"],
    });
    expect(definition?.inputJsonSchema).toEqual(expect.objectContaining({ type: "object" }));
    const controller = new AbortController();
    await expect(
      definition?.execute(
        { state: "open" },
        {
          runId: "run-1",
          productId: "example",
          userId: "user-1",
          abortSignal: controller.signal,
        },
      ),
    ).resolves.toBe("ok");
    const callTool = vi.mocked(client.callTool);
    expect(callTool).toHaveBeenCalledWith("list_issues", { state: "open" }, controller.signal);
  });
});
