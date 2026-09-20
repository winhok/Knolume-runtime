import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LocalTraceRecorder, inspectTrace } from "./recorder.js";
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "runtime-trace-"));
  dirs.push(dir);
  return dir;
}
it("records and inspects a run while redacting nested credential fields", async () => {
  const dir = await directory();
  const trace = await LocalTraceRecorder.start({
    directory: dir,
    sessionId: "../session",
    model: "fixture",
    parentTraceId: "parent-trace",
    parentRunId: "parent-run",
  });
  expect(dirname(trace.filePath)).toBe(dir);
  const messages = [
    {
      role: "assistant" as const,
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "1",
          toolName: "lookup",
          input: {
            query: "safe",
            apiKey: "sensitive",
            nested: [{ password: "hidden" }],
          },
        },
      ],
    },
  ];
  await trace.recordStepStarted({ step: 1, system: "system", messages });
  await trace.recordAttemptError(1, 1, new Error("retry"));
  await trace.recordStepCompleted({
    step: 1,
    text: "done",
    outputMessages: messages,
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  });
  await trace.finish("completed");
  const raw = await readFile(trace.filePath, "utf8");
  expect(raw).not.toContain("sensitive");
  expect(raw).not.toContain("hidden");
  expect(raw).toContain("[REDACTED]");
  const events = raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events[0]).toMatchObject({
    parentTraceId: "parent-trace",
    parentRunId: "parent-run",
  });
  expect(events[2]).toMatchObject({ error: "retry", attempt: 1 });
  expect(events[3].usage.inputTokens).toBe(10);
  const summary = await inspectTrace(trace.filePath);
  expect(summary).toContain("12 tokens · tools: lookup");
  expect(summary).toContain("Status: completed");
});
it("supports incomplete traces and absent optional step metadata", async () => {
  const dir = await directory();
  const path = join(dir, "partial.jsonl");
  await writeFile(
    path,
    '{"type":"step_started","step":1}\n{"type":"step_completed"}\n',
  );
  const summary = await inspectTrace(path);
  expect(summary).toContain("context 0 messages");
  expect(summary).toContain("0 tokens");
  expect(summary).toContain("Status: incomplete");
  const trace = await LocalTraceRecorder.start({
    directory: dir,
    sessionId: "",
    model: "fixture",
  });
  await trace.recordStepCompleted({
    step: 9,
    text: "",
    outputMessages: [{ role: "user", content: "plain" }],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  });
  await trace.finish("failed", "failure");
  expect(await inspectTrace(trace.filePath)).toContain("Status: failed");
});
it("disables recording after a write failure without disrupting the caller", async () => {
  const dir = await directory();
  const trace = await LocalTraceRecorder.start({
    directory: dir,
    sessionId: "failure",
    model: "fixture",
  });
  await rm(dir, { recursive: true });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await trace.recordAttemptError(1, 1, "failure");
  await trace.finish("failed");
  expect(warn).toHaveBeenCalledTimes(1);
});
