import { describe, expect, it } from "vitest";
import { buildContextSnapshot, renderContextMatrix, renderContextView } from "./view.js";

describe("Context view", () => {
  it("renders an effective-window matrix without inventing provider metadata", () => {
    const snapshot = buildContextSnapshot({
      modelName: "openai-compatible",
      modelId: null,
      windowTokens: null,
      effectiveWindowTokens: 950_000,
      autocompactThresholdTokens: 200_000,
      systemPromptChars: 100,
      toolDescriptionChars: 100,
      memoryChars: 0,
      ragChars: 0,
      skillsChars: 0,
      messages: [{ role: "user", content: "hello" }],
      tokenMeasurement: { observedPromptTokens: null, pendingEstimatedTokens: 0 },
    });

    expect(renderContextMatrix(snapshot).split("\n")).toHaveLength(16);
    expect(snapshot.safetyReserveTokens).toBeNull();
    expect(renderContextView(snapshot)).toContain("Nominal provider window: unknown");
    expect(renderContextView(snapshot)).toContain("Provider model id unknown");
    expect(renderContextView(snapshot)).toContain("Measurement: local estimate");
  });
});
