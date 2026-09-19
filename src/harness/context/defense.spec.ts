import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { TokenTracker } from "./defense.js";
import { textToolResultOutput } from "./tool-result-output.js";

describe("TokenTracker", () => {
  it("combines an API baseline with new structured messages", () => {
    const tracker = new TokenTracker(1_000_000);
    tracker.updateFromAPI(1_000);

    const messages: ModelMessage[] = [
      { role: "user", content: "12345678" },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "lookup_record",
            output: textToolResultOutput("abcdefgh"),
          },
        ],
      },
    ];

    tracker.addMessages(messages);

    expect(tracker.estimatedTokens).toBe(1_004);
    expect(tracker.measurement).toEqual({
      observedPromptTokens: 1_000,
      pendingEstimatedTokens: 4,
    });
  });

  it("reports a local-only measurement before API usage", () => {
    const tracker = new TokenTracker(1_000_000);
    tracker.addMessage({ role: "user", content: "12345678" });

    expect(tracker.measurement).toEqual({
      observedPromptTokens: null,
      pendingEstimatedTokens: 2,
    });
  });

  it("keeps its precise baseline when defense replaces content", () => {
    const tracker = new TokenTracker(1_000_000);
    tracker.updateFromAPI(1_000);

    const before: ModelMessage[] = [{ role: "user", content: "12345678" }];
    const after: ModelMessage[] = [{ role: "user", content: "1234" }];
    tracker.replaceMessages(before, after);

    expect(tracker.estimatedTokens).toBe(999);
  });

  it("resets pending estimates when a new API measurement arrives", () => {
    const tracker = new TokenTracker(100);
    tracker.addMessage({ role: "user", content: "12345678" });
    tracker.updateFromAPI(80);

    expect(tracker.measurement).toEqual({
      observedPromptTokens: 80,
      pendingEstimatedTokens: 0,
    });
    expect(tracker.status).toEqual({ tokens: 80, percent: 80, needsAction: true });
  });
});
