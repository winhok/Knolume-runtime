import { describe, expect, it, vi } from "vitest";
import { SubAgentRegistry } from "./registry.js";
import type { SubAgentRun } from "./types.js";

function runningRun(id: string): SubAgentRun {
  return {
    id,
    task: "running task",
    profile: "general",
    status: "running",
    depth: 1,
    startedAt: new Date().toISOString(),
  };
}

describe("SubAgentRegistry", () => {
  it("enforces depth and concurrency limits per registry instance", () => {
    const registry = new SubAgentRegistry({ maxSpawnDepth: 1, maxConcurrent: 1 });

    expect(registry.canSpawn(1).reason).toContain("最大嵌套深度 1");

    const id = registry.generateId();
    registry.register(runningRun(id));
    expect(registry.canSpawn(0).reason).toContain("最大并发数 1");

    registry.complete(id, "done");
    expect(registry.get(id)).toMatchObject({ status: "completed", result: "done" });
    expect(registry.canSpawn(0)).toEqual({ ok: true });
  });

  it("isolates active runs and id counters between root runs", () => {
    const firstRoot = new SubAgentRegistry({ maxConcurrent: 1 });
    const secondRoot = new SubAgentRegistry({ maxConcurrent: 1 });
    const firstId = firstRoot.generateId();
    const secondId = secondRoot.generateId();
    firstRoot.register(runningRun(firstId));

    expect(firstId).toMatch(/^sub-1-/);
    expect(secondId).toMatch(/^sub-1-/);
    expect(firstRoot.canSpawn(0).ok).toBe(false);
    expect(secondRoot.canSpawn(0)).toEqual({ ok: true });
    expect(secondRoot.getActiveRuns()).toEqual([]);
  });

  it("notifies the observer for durable status transitions", () => {
    const onRunChanged = vi.fn<(run: SubAgentRun) => void>();
    const registry = new SubAgentRegistry(undefined, { onRunChanged });
    const run = runningRun(registry.generateId());

    registry.register(run);
    registry.complete(run.id, "done", {
      steps: 2,
      toolCalls: 1,
      retries: 0,
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });

    expect(onRunChanged).toHaveBeenCalledTimes(2);
    const completedRun = onRunChanged.mock.calls.at(-1)?.[0];
    expect(completedRun).toMatchObject({
      id: run.id,
      status: "completed",
      result: "done",
      stats: { steps: 2, toolCalls: 1 },
    });
  });
});
