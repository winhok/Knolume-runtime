import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { RunContextProjection } from "./run-context-projection.js";

const GENERATE_USAGE = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

describe("RunContextProjection", () => {
  it("compacts only the run-local model projection", async () => {
    const source = longTranscript();
    const durableSnapshot = JSON.stringify(source);
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: "原始历史的结构化摘要" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: GENERATE_USAGE,
        warnings: [],
      },
    });
    const projection = new RunContextProjection(source, {
      effectiveContextWindowTokens: 10_000,
      autocompactThresholdTokens: 1,
    });

    const result = await projection.prepare(model);

    expect(result.compaction.compacted).toBe(true);
    expect(result.compaction.summarizedMessages).toBeGreaterThan(0);
    expect(projection.messages[0]).toEqual({
      role: "user",
      content: "<compacted-summary>\n原始历史的结构化摘要\n</compacted-summary>",
    });
    expect(JSON.stringify(source)).toBe(durableSnapshot);
  });

  it("uses precise provider input usage before deciding follow-up compaction", async () => {
    const source: ModelMessage[] = [{ role: "user", content: "short" }];
    const model = new MockLanguageModelV4();
    const projection = new RunContextProjection(source, {
      effectiveContextWindowTokens: 10_000,
      autocompactThresholdTokens: 500,
    });

    const result = await projection.recordStep(
      model,
      {
        inputTokens: 600,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      [{ role: "assistant", content: "done" }],
      false,
    );

    expect(result.compacted).toBe(false);
    expect(projection.estimatedTokens).toBeGreaterThanOrEqual(600);
    expect(source).toEqual([{ role: "user", content: "short" }]);
  });
});

function longTranscript(): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (let turn = 0; turn < 5; turn++) {
    messages.push(
      { role: "user", content: `question ${turn} ${"x".repeat(300)}` },
      { role: "assistant", content: `answer ${turn} ${"y".repeat(300)}` },
    );
  }
  return messages;
}
