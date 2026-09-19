import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InvalidTraceIdError, TraceDataCorruptError, TraceReadRepository } from "./repository.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("TraceReadRepository", () => {
  it("returns a structured projection without prompt, output, or secret values", async () => {
    const directory = makeTempDir();
    writeTrace(directory, "trace-1", [
      {
        type: "trace_started",
        traceId: "trace-1",
        sessionId: "session-1",
        model: "model-1",
        timestamp: "2026-08-09T01:00:00.000Z",
      },
      {
        type: "step_started",
        traceId: "trace-1",
        step: 1,
        timestamp: "2026-08-09T01:00:01.000Z",
        context: {
          system: "API_KEY=should-not-leak",
          messages: [{ role: "user", content: "secret prompt" }],
        },
      },
      {
        type: "step_completed",
        traceId: "trace-1",
        step: 1,
        timestamp: "2026-08-09T01:00:02.000Z",
        durationMs: 1000,
        output: {
          text: "secret answer",
          authorization: "Bearer secret",
          messages: [
            {
              role: "assistant",
              content: [{ type: "tool-call", toolName: "grep" }],
            },
          ],
        },
        usage: {
          inputTokens: 10,
          outputTokens: 3,
          cacheReadTokens: 2,
          cacheWriteTokens: 0,
        },
      },
      {
        type: "trace_finished",
        traceId: "trace-1",
        timestamp: "2026-08-09T01:00:03.000Z",
        status: "completed",
        durationMs: 3000,
      },
    ]);

    const trace = await new TraceReadRepository(directory).get("trace-1");

    expect(trace).toMatchObject({
      traceId: "trace-1",
      sessionId: "session-1",
      model: "model-1",
      status: "completed",
      steps: [
        {
          step: 1,
          durationMs: 1000,
          toolNames: ["grep"],
          outputTextLength: 13,
          usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 },
        },
      ],
    });
    expect(JSON.stringify(trace)).not.toContain("should-not-leak");
    expect(JSON.stringify(trace)).not.toContain("secret prompt");
    expect(JSON.stringify(trace)).not.toContain("Bearer secret");
  });

  it("rejects path-like identifiers before filesystem access", async () => {
    await expect(new TraceReadRepository(makeTempDir()).get("../trace-1")).rejects.toBeInstanceOf(
      InvalidTraceIdError,
    );
  });

  it("rejects a file whose embedded identity does not match", async () => {
    const directory = makeTempDir();
    writeTrace(directory, "trace-1", [{ type: "trace_started", traceId: "trace-other" }]);
    await expect(new TraceReadRepository(directory).get("trace-1")).rejects.toBeInstanceOf(
      TraceDataCorruptError,
    );
  });
});

function makeTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "kernifold-trace-repository-test-"));
  tempDirs.push(directory);
  return directory;
}

function writeTrace(directory: string, traceId: string, events: object[]): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${traceId}.jsonl`),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
}
