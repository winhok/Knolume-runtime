import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { remapMessageTimestamps } from "./store.js";

describe("remapMessageTimestamps", () => {
  it("preserves retained message timestamps after compaction shifts indices", () => {
    const before: ModelMessage[] = [
      { role: "user", content: "old" },
      { role: "assistant", content: "old response" },
      { role: "user", content: "recent" },
      { role: "assistant", content: "recent response" },
    ];
    const summary: ModelMessage = { role: "user", content: "summary" };
    const recentUser = before[2];
    const recentAssistant = before[3];
    if (!recentUser || !recentAssistant) throw new Error("Missing retained messages");
    const after = [summary, recentUser, recentAssistant];
    const timestamps = new Map([
      [0, 100],
      [1, 200],
      [2, 300],
      [3, 400],
    ]);

    expect([...remapMessageTimestamps(before, after, timestamps, 999)]).toEqual([
      [0, 999],
      [1, 300],
      [2, 400],
    ]);
  });

  it("preserves timestamps by index for same-shape defense replacements", () => {
    const before: ModelMessage[] = [{ role: "user", content: "before" }];
    const after: ModelMessage[] = [{ role: "user", content: "after" }];

    expect([...remapMessageTimestamps(before, after, new Map([[0, 123]]), 999)]).toEqual([
      [0, 123],
    ]);
  });
});
