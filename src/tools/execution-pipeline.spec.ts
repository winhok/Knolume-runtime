import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolExecutionPipeline } from "./execution-pipeline.js";
import type { ExecutableTool } from "./registry.js";

const externalTool: ExecutableTool = {
  name: "external_read",
  description: "read external data",
  inputSchema: z.object({}).strict(),
  capabilities: ["external"],
  execute: vi.fn().mockResolvedValue("ok"),
};

describe("ToolExecutionPipeline cancellation audit", () => {
  it("records a cancelled approval as aborted", async () => {
    const pipeline = new ToolExecutionPipeline();
    const controller = new AbortController();
    const approval = vi.fn(() => {
      const error = new DOMException("cancelled", "AbortError");
      controller.abort(error);
      return Promise.reject<boolean>(error);
    });

    await expect(
      pipeline.execute(
        externalTool,
        {},
        { runId: "run-1", productId: "example", userId: "user-1", abortSignal: controller.signal },
        { enforcePermissions: true, requestApproval: approval },
      ),
    ).rejects.toThrow();
    expect(pipeline.getAuditLog()).toMatchObject([
      { outcome: "aborted", permission: { level: "ask", approval: "cancelled" } },
    ]);
  });

  it("records an aborted tool call separately from failures", async () => {
    const pipeline = new ToolExecutionPipeline();
    const controller = new AbortController();
    const tool: ExecutableTool = {
      ...externalTool,
      capabilities: ["read"],
      execute: () => {
        const error = new DOMException("cancelled", "AbortError");
        controller.abort(error);
        return Promise.reject(error);
      },
    };
    await expect(
      pipeline.execute(
        tool,
        {},
        {
          runId: "run-1",
          productId: "example",
          userId: "user-1",
          abortSignal: controller.signal,
        },
      ),
    ).rejects.toThrow();
    expect(pipeline.getAuditLog()[0]?.outcome).toBe("aborted");
  });
});

describe("host-owned permission policy", () => {
  it("evaluates validated hook-modified input and honors deny before approval", async () => {
    const { ToolHookPipeline } = await import("./hooks.js");
    const hooks = new ToolHookPipeline();
    hooks.registerPre("transform", () => ({ action: "modify", modifiedInput: { action: "blocked" } }));
    const execute = vi.fn().mockResolvedValue("unexpected");
    const requestApproval = vi.fn().mockResolvedValue(true);
    const permissionPolicy = vi.fn((_tool, input) => ({
      level: input.action === "blocked" ? "deny" as const : "allow" as const,
      reason: "host policy",
    }));
    const tool: ExecutableTool = {
      name: "host_operation", description: "host", inputSchema: z.object({ action: z.string() }).strict(),
      capabilities: ["read"], execute,
    };
    const context = { runId: "run-1", productId: "example", userId: "user-1" };
    const pipeline = new ToolExecutionPipeline(hooks);
    await expect(pipeline.execute(tool, { action: "allowed" }, context, {
      enforcePermissions: true, permissionPolicy, requestApproval,
    })).resolves.toContain("[拒绝执行]");
    expect(permissionPolicy).toHaveBeenCalledWith(tool, { action: "blocked" }, context);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(pipeline.getAuditLog()[0]).toMatchObject({ outcome: "denied", permission: { level: "deny" } });
  });

  it("requires approval when the host policy returns ask", async () => {
    const execute = vi.fn().mockResolvedValue("done");
    const tool: ExecutableTool = { ...externalTool, execute };
    const pipeline = new ToolExecutionPipeline();
    const requestApproval = vi.fn().mockResolvedValue(true);
    const result = await pipeline.execute(tool, {}, { runId: "run-1", productId: "example", userId: "user-1" }, {
      enforcePermissions: true,
      permissionPolicy: () => ({ level: "ask", reason: "host approval required" }),
      requestApproval,
    });
    expect(result).toBe("done");
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });
});
