import type { ModelMessage, ToolModelMessage } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import {
  applyDefense,
  estimateMessageTokens,
  truncateToolResults,
  ttlPrune,
} from "./defense.js";
import { toolResultOutputToText } from "./tool-result-output.js";
afterEach(() => vi.restoreAllMocks());
function tool(text: string): ToolModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call",
        toolName: "lookup",
        output: { type: "text", value: text },
      },
    ],
  };
}
function output(messages: ModelMessage[], index = 0) {
  const message = messages[index] as ToolModelMessage;
  const part = message.content[0];
  if (!part || part.type !== "tool-result") throw new Error("missing result");
  return toolResultOutputToText(part.output);
}
it("truncates oversized results while retaining their head, tail and call identity", () => {
  const original = tool("HEAD" + "x".repeat(100) + "TAIL");
  const result = truncateToolResults([original], 1000, {
    maxSingleResult: 20,
    contextBudgetChars: 1000,
  });
  expect(result).toMatchObject({ truncated: 1, compacted: 0 });
  expect(output(result.messages)).toMatch(/^HEAD[\s\S]*TAIL$/);
  expect((result.messages[0] as ToolModelMessage).content[0]).toMatchObject({
    toolCallId: "call",
    toolName: "lookup",
  });
  expect(output([original])).toHaveLength(108);
});
it("compacts oldest tool results while leaving user and assistant context intact", () => {
  const messages: ModelMessage[] = [
    { role: "user", content: "keep" },
    tool("x".repeat(200)),
    { role: "assistant", content: [{ type: "text", text: "answer" }] },
    tool("recent"),
  ];
  const result = truncateToolResults(messages, 1000, {
    maxSingleResult: 1000,
    contextBudgetChars: 100,
  });
  expect(result.compacted).toBe(1);
  expect(output(result.messages, 1)).toContain("compacted: lookup");
  expect(result.messages[0]).toBe(messages[0]);
  expect(output(result.messages, 3)).toBe("recent");
});
it("applies soft and hard TTL boundaries but preserves failures and undated results", () => {
  vi.spyOn(Date, "now").mockReturnValue(100_000);
  const messages: ModelMessage[] = [
    tool("head-middle-tail"),
    tool("expired"),
    tool("error: timeout"),
    tool("undated"),
    tool("new"),
    tool("ok"),
    { role: "user", content: "keep" },
  ];
  const result = ttlPrune(
    messages,
    new Map([
      [0, 99_000],
      [1, 98_000],
      [2, 1],
      [4, 99_999],
      [5, 99_000],
    ]),
    { softTTLMs: 1000, hardTTLMs: 2000, keepHeadTail: 4 },
  );
  expect(result).toMatchObject({ softPruned: 1, hardPruned: 1 });
  expect(output(result.messages)).toMatch(/^head[\s\S]*tail$/);
  expect(output(result.messages, 1)).toBe("[tool result expired: lookup]");
  for (const i of [2, 3, 4]) expect(result.messages[i]).toBe(messages[i]);
  expect(output(result.messages, 5)).toBe("ok");
});
it("estimates structured tool-call input and applies default expiry settings", () => {
  const messages: ModelMessage[] = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "c",
          toolName: "lookup",
          input: { id: 1 },
        },
      ],
    },
  ];
  expect(estimateMessageTokens(messages)).toBe(3);
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const result = applyDefense([tool("old")], new Map([[0, 1]]), 10000);
  expect(result.hardPruned).toBe(1);
  expect(result.tokenEstimate).toBeGreaterThan(0);
});
it("converts all supported tool output categories to readable context", () => {
  expect(toolResultOutputToText({ type: "json", value: { ok: true } })).toBe(
    '{"ok":true}',
  );
  expect(
    toolResultOutputToText({ type: "error-json", value: { error: "failed" } }),
  ).toContain("failed");
  expect(toolResultOutputToText({ type: "error-text", value: "failed" })).toBe(
    "failed",
  );
  expect(
    toolResultOutputToText({ type: "execution-denied", reason: "policy" }),
  ).toContain("policy");
  expect(toolResultOutputToText({ type: "execution-denied" })).toBe(
    "[execution denied]",
  );
  expect(
    toolResultOutputToText({
      type: "content",
      value: [
        { type: "text", text: "caption" },
        {
          type: "file",
          mediaType: "image/png",
          data: { type: "data", data: "AA==" },
        },
      ],
    }),
  ).toBe("caption\n[media: image/png]");
});
