import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  InvalidToolInputError,
  sanitizeAuditValue,
  ToolExecutionPipeline,
  truncateResult,
} from "./execution-pipeline.js";
import { ToolRegistry, ToolsetRegistry, type ExecutableTool } from "./registry.js";
import { ToolHookPipeline } from "./hooks.js";
import { createToolSearchTool } from "./tool-search.js";

const echoTool: ExecutableTool<{ value: string }> = {
  name: "echo",
  description: "echo",
  inputSchema: z.object({ value: z.string() }).strict(),
  capabilities: ["read"],
  execute: ({ value }) => Promise.resolve(value),
};

describe("ToolRegistry", () => {
  it("isolates deferred discovery between Agent views", () => {
    const deferred: ExecutableTool = {
      name: "mcp__docs__search",
      description: "search docs",
      inputSchema: z.object({}),
      capabilities: ["external"],
      shouldDefer: true,
      execute: () => Promise.resolve("ok"),
    };
    const registry = new ToolRegistry([deferred]);
    const root = registry.createView();
    const child = registry.createView();

    root.searchTools("mcp__docs__search");

    expect(root.getActiveTools().map((tool) => tool.name)).toContain("mcp__docs__search");
    expect(child.getActiveTools().map((tool) => tool.name)).not.toContain("mcp__docs__search");
    expect(child.getDeferredToolSummary()).toContain("mcp__docs__search");
  });

  it("resolves a Toolset without Agent or Role state", () => {
    const tools = new ToolRegistry([echoTool]);
    const toolsets = new ToolsetRegistry([{ id: "readonly", toolNames: ["echo"] }]);

    expect(tools.resolve(toolsets.require("readonly").toolNames)).toEqual([echoTool]);
  });

  it("rejects duplicate Tool names", () => {
    expect(() => new ToolRegistry([echoTool, echoTool])).toThrow("already registered");
  });

  it("keeps deferred tools hidden until tool_search discovers exact names", async () => {
    const deferred: ExecutableTool = {
      ...echoTool,
      name: "mcp__github__issues",
      shouldDefer: true,
      searchHint: "github issues",
      inputJsonSchema: { type: "object", properties: {} },
    };
    const tools = new ToolRegistry([echoTool, deferred]);
    const search = createToolSearchTool(tools);

    expect(tools.getActiveTools().map((tool) => tool.name)).toEqual(["echo"]);
    expect(tools.getDeferredToolSummary()).toContain("mcp__github__issues — github issues");
    await expect(
      search.execute(
        { query: "mcp__github__issues" },
        { runId: "run-1", productId: "example", userId: "user-1" },
      ),
    ).resolves.toEqual([expect.objectContaining({ name: "mcp__github__issues" })]);
    expect(tools.getActiveTools().map((tool) => tool.name)).toEqual([
      "echo",
      "mcp__github__issues",
    ]);
  });

  it("does not discover a deferred tool outside the capability selection", () => {
    const deferred: ExecutableTool = {
      ...echoTool,
      name: "mcp__github__write",
      capabilities: ["external"],
      shouldDefer: true,
    };
    const tools = new ToolRegistry([deferred]);
    expect(
      tools.searchTools("mcp__github__write", { allowedCapabilities: new Set(["read"]) }),
    ).toEqual([]);
    expect(tools.getActiveTools()).toEqual([]);
  });
});

describe("ToolExecutionPipeline", () => {
  const pipeline = new ToolExecutionPipeline();
  const context = { runId: "run-1", productId: "example", userId: "user-1" };

  it("validates and executes a Tool with its minimal Run context", async () => {
    await expect(pipeline.execute(echoTool, { value: "ok" }, context)).resolves.toBe("ok");
  });

  it("rejects invalid input before execution", async () => {
    await expect(pipeline.execute(echoTool, { value: 1 }, context)).rejects.toBeInstanceOf(
      InvalidToolInputError,
    );
  });

  it("revalidates hook-modified input before permission and execution", async () => {
    const execute = vi.fn(() => Promise.resolve("unsafe"));
    const tool: ExecutableTool<{ command: string }> = {
      name: "external_action",
      description: "shell",
      inputSchema: z.object({ command: z.string() }).strict(),
      capabilities: ["execute"],
      execute,
    };
    const hooks = new ToolHookPipeline();
    hooks.registerPre("rewrite", () => ({
      action: "modify",
      modifiedInput: { command: "blocked-action" },
    }));
    const secured = new ToolExecutionPipeline(hooks);

    await expect(
      secured.execute(tool, { command: "pwd" }, context, { enforcePermissions: true }),
    ).resolves.toContain("[拒绝执行]");
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks through pre hooks, transforms output, and records redacted audit", async () => {
    const hooks = new ToolHookPipeline();
    hooks.registerPost("suffix", (_tool, _input, output) => ({
      action: "modify",
      modifiedOutput: `${String(output)}!`,
    }));
    const audited = new ToolExecutionPipeline(hooks);

    await expect(
      audited.execute(echoTool, { value: "ok", apiKey: "secret" }, context),
    ).rejects.toBeInstanceOf(InvalidToolInputError);
    await expect(audited.execute(echoTool, { value: "ok" }, context)).resolves.toBe("ok!");
    expect(audited.getAuditLog()).toEqual(
      expect.arrayContaining([expect.objectContaining({ tool: "echo", outcome: "completed" })]),
    );

    const secretTool: ExecutableTool<{ apiKey: string }> = {
      name: "secret",
      description: "secret",
      inputSchema: z.object({ apiKey: z.string() }).strict(),
      capabilities: ["read"],
      execute: () => Promise.resolve("ok"),
    };
    await audited.execute(secretTool, { apiKey: "do-not-store" }, context);
    expect(audited.getAuditLog().at(-1)?.input).toEqual({ apiKey: "[REDACTED]" });
  });

  it("retains the head and tail when truncating output", () => {
    expect(truncateResult("abcdefghij", 6)).toBe("abc\n\n... [省略 4 字符] ...\n\nhij");
  });

  it("preserves the shared-read and exclusive-mutation coordination", async () => {
    const events: string[] = [];
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readTool: ExecutableTool = {
      ...echoTool,
      name: "read",
      isConcurrencySafe: true,
      execute: async () => {
        events.push("read:start");
        await readGate;
        events.push("read:end");
        return "read";
      },
    };
    const writeTool: ExecutableTool = {
      ...echoTool,
      name: "write",
      isConcurrencySafe: false,
      execute: () => {
        events.push("write:start");
        return Promise.resolve("write");
      },
    };

    const read = pipeline.execute(readTool, { value: "read" }, context);
    await Promise.resolve();
    const write = pipeline.execute(writeTool, { value: "write" }, context);
    await Promise.resolve();
    expect(events).toEqual(["read:start"]);

    releaseRead();
    await Promise.all([read, write]);
    expect(events).toEqual(["read:start", "read:end", "write:start"]);
  });

  it("does not execute a queued mutation after its Run is cancelled", async () => {
    const isolated = new ToolExecutionPipeline();
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readTool: ExecutableTool = {
      ...echoTool,
      name: "held-read",
      isConcurrencySafe: true,
      execute: async () => {
        await readGate;
        return "read";
      },
    };
    const executeWrite = vi.fn(() => Promise.resolve("write"));
    const writeTool: ExecutableTool = {
      ...echoTool,
      name: "queued-write",
      isConcurrencySafe: false,
      execute: executeWrite,
    };
    const controller = new AbortController();

    const read = isolated.execute(readTool, { value: "read" }, context);
    await Promise.resolve();
    const write = isolated.execute(
      writeTool,
      { value: "write" },
      {
        ...context,
        abortSignal: controller.signal,
      },
    );
    await Promise.resolve();
    controller.abort();

    await expect(write).rejects.toMatchObject({ name: "AbortError" });
    releaseRead();
    await expect(read).resolves.toBe("read");
    expect(executeWrite).not.toHaveBeenCalled();
  });

  it("bounds and cycle-proofs audit projections", () => {
    const cyclic: Record<string, unknown> = { token: "secret" };
    cyclic.self = cyclic;
    cyclic.deep = { one: { two: { three: { four: { five: "hidden" } } } } };

    expect(sanitizeAuditValue(cyclic)).toMatchObject({
      token: "[REDACTED]",
      self: "[CIRCULAR]",
      deep: { one: { two: { three: { four: "[MAX_DEPTH]" } } } },
    });
    expect(
      Object.keys(
        sanitizeAuditValue(
          Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`key-${index}`, index])),
        ) as object,
      ),
    ).toHaveLength(50);
  });
});
