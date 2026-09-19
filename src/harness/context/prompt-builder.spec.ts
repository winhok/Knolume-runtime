import { describe, expect, it } from "vitest";
import { PromptBuilder, PromptSnapshotState, renderPromptSnapshot } from "./prompt-builder.js";

const context = {
  toolNames: new Set(["memory"]),
  deferredToolSummary: "",
  sessionMessageCount: 0,
  sessionId: "session-1",
};

describe("PromptBuilder", () => {
  it("separates authority surfaces and gates sections by available tools", () => {
    const assembly = new PromptBuilder()
      .pipe({ name: "rules", surface: "system", render: () => "rules" })
      .pipe({
        name: "memory",
        surface: "runtime",
        requiresTools: ["memory"],
        render: () => "index",
      })
      .pipe({
        name: "delegate",
        surface: "runtime",
        requiresTools: ["spawn_agent"],
        render: () => "delegate",
      })
      .assemble(context);

    expect(assembly.system).toBe("rules");
    expect(assembly.snapshots.find((snapshot) => snapshot.surface === "runtime")?.text).toBe(
      "index",
    );
  });

  it("emits a complete snapshot only when its digest changes", () => {
    const state = new PromptSnapshotState();
    const snapshot = new PromptBuilder()
      .pipe({ name: "memory", surface: "runtime", render: () => "index" })
      .assemble(context).snapshots[1];
    expect(state.selectUpdates([snapshot])).toEqual([snapshot]);
    expect(state.selectUpdates([snapshot])).toEqual([]);
    const persisted = renderPromptSnapshot(snapshot);
    const restored = new PromptSnapshotState();
    restored.restore([persisted]);
    expect(restored.selectUpdates([snapshot])).toEqual([]);
  });
});
