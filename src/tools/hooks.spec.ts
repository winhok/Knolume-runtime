import { describe, expect, it, vi } from "vitest";
import { ToolHookPipeline } from "./hooks.js";

describe("ToolHookPipeline", () => {
  it("chains pre input and post output modifications in registration order", async () => {
    const hooks = new ToolHookPipeline();
    hooks.registerPre("first", (_tool, input) => ({
      action: "modify",
      modifiedInput: { value: `${String((input as { value: string }).value)}-a` },
    }));
    hooks.registerPre("second", (_tool, input) => ({
      action: "modify",
      modifiedInput: { value: `${String((input as { value: string }).value)}-b` },
    }));
    hooks.registerPost("output", (_tool, _input, output) => ({
      action: "modify",
      modifiedOutput: `${String(output)}-post`,
    }));

    await expect(hooks.runPre("echo", { value: "input" })).resolves.toEqual({
      action: "modify",
      modifiedInput: { value: "input-a-b" },
    });
    await expect(hooks.runPost("echo", {}, "output")).resolves.toEqual({
      action: "allow",
      modifiedOutput: "output-post",
    });
  });

  it("blocks immediately and isolates hook failures", async () => {
    const onFailure = vi.fn();
    const skipped = vi.fn();
    const hooks = new ToolHookPipeline(onFailure);
    hooks.registerPre("broken", () => {
      throw new Error("offline");
    });
    hooks.registerPre("block", () => ({ action: "block", reason: "policy" }));
    hooks.registerPre("skipped", skipped);

    await expect(hooks.runPre("echo", {})).resolves.toEqual({
      action: "block",
      reason: "policy",
    });
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "pre", hookName: "broken" }),
    );
    expect(skipped).not.toHaveBeenCalled();
  });
});
