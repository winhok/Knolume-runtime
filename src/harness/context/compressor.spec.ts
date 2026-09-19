import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  CompactionCircuitBreaker,
  estimateTokens,
  pruneOldestContext,
  serializeMessageForCompaction,
  summarize,
} from "./compressor.js";

describe("context compaction reliability", () => {
  it("preserves tool call identity and arguments in compression input", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-exact-123",
          toolName: "lookup_record",
          input: { path: "/workspace/exact.ts", line: 42 },
        },
      ],
    } as ModelMessage;

    const serialized = serializeMessageForCompaction(message);
    expect(serialized).toContain("lookup_record");
    expect(serialized).toContain("call-exact-123");
    expect(serialized).toContain("/workspace/exact.ts");
    expect(serialized).toContain("42");
  });

  it("opens after consecutive failures and resets after success", () => {
    const breaker = new CompactionCircuitBreaker(3);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen).toBe(true);
    breaker.recordSuccess();
    expect(breaker.isOpen).toBe(false);
  });

  it("rejects a summary truncated by the output token limit", async () => {
    const model = completionModel("partial summary", "length");
    await expect(
      summarize(model, conversationWithLargeToolCall("x".repeat(8_000)), "", {
        thresholdTokens: 1,
        keepRecentMessages: 2,
        maxOutputTokens: 32,
      }),
    ).rejects.toThrow(/ended with length/);
  });

  it("uses large tool-call arguments for size and progress checks", async () => {
    const messages = conversationWithLargeToolCall("x".repeat(20_080));
    expect(estimateTokens(messages)).toBeGreaterThan(5_000);
    const result = await summarize(completionModel("complete summary", "stop"), messages, "", {
      thresholdTokens: 1,
      keepRecentMessages: 2,
    });
    expect(result.compressedCount).toBeGreaterThan(0);
    expect(estimateTokens(result.messages)).toBeLessThan(estimateTokens(messages));
  });

  it("deterministically prunes an old prefix when summarization is unavailable", () => {
    const messages = Array.from({ length: 8 }, (_, index) => ({
      role: "user" as const,
      content: `${index}-${"x".repeat(200)}`,
    }));
    const result = pruneOldestContext(messages, 120);
    expect(result.compressedCount).toBeGreaterThan(0);
    expect(result.messages[0]?.content).toEqual(expect.stringContaining("deterministic-prune"));
  });
});

function completionModel(text: string, finishReason: "stop" | "length") {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: finishReason, raw: finishReason },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

function conversationWithLargeToolCall(argument: string): ModelMessage[] {
  return [
    { role: "user", content: "start" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "large-call",
          toolName: "save_record",
          input: { content: argument },
        },
      ],
    },
    { role: "user", content: "middle-1" },
    { role: "assistant", content: "middle-2" },
    { role: "user", content: "recent-1" },
    { role: "assistant", content: "recent-2" },
  ];
}

describe("host-owned microcompaction selection", () => {
  it("keeps results by default and clears only explicitly selected tool names", async () => {
    const { microcompact } = await import("./compressor.js");
    const messages: ModelMessage[] = Array.from({ length: 5 }, (_, i) => ({
      role: "tool", content: [{ type: "tool-result", toolCallId: `call-${i}`, toolName: i === 0 ? "lookup_record" : "other", output: { type: "text", value: "original" } }],
    }));
    expect(microcompact(messages).cleared).toBe(0);
    const result = microcompact(messages, new Set(["lookup_record"]));
    expect(result.cleared).toBe(1);
    expect(JSON.stringify(result.messages[0])).toContain("[tool result cleared]");
    expect(JSON.stringify(result.messages[1])).toContain("original");
    expect(JSON.stringify(messages[0])).toContain("original");
  });
});
