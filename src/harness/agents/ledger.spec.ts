import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SubAgentRunLedger } from "./ledger.js";

const ledgers: SubAgentRunLedger[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SubAgentRunLedger", () => {
  it("persists bounded, redacted child summaries and status transitions", () => {
    const ledger = makeLedger();
    const scope = {
      productId: "example",
      userId: "user-1",
      sessionId: "session-1",
      rootRunId: "run-root",
    };
    const observer = ledger.observer(scope);
    observer.onRunChanged({
      id: "sub-1",
      task: `inspect token=super-secret ${"x".repeat(400)}`,
      profile: "explorer",
      status: "running",
      depth: 1,
      startedAt: "2026-08-09T01:00:00.000Z",
    });
    observer.onRunChanged({
      id: "sub-1",
      task: "inspect token=super-secret",
      profile: "explorer",
      status: "completed",
      depth: 1,
      startedAt: "2026-08-09T01:00:00.000Z",
      finishedAt: "2026-08-09T01:00:02.000Z",
      result: `Bearer provider-secret ${"y".repeat(500)}`,
      stats: {
        steps: 2,
        toolCalls: 1,
        retries: 0,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 2,
          cacheWriteTokens: 0,
        },
      },
    });

    const [record] = ledger.recent({
      productId: "example",
      userId: "user-1",
      sessionId: "session-1",
    });
    expect(record).toMatchObject({
      childRunId: "sub-1",
      rootRunId: "run-root",
      status: "completed",
      stats: { steps: 2, toolCalls: 1 },
    });
    expect(record?.taskPreview.length).toBeLessThanOrEqual(200);
    expect(record?.resultPreview?.length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(record)).not.toContain("super-secret");
    expect(JSON.stringify(record)).not.toContain("provider-secret");
  });

  it("isolates Product subjects and reconciles abandoned running children", () => {
    const directory = makeDirectory();
    const dbPath = join(directory, "runs.db");
    const ledger = new SubAgentRunLedger(dbPath);
    const run = {
      id: "sub-1",
      task: "inspect",
      profile: "explorer",
      status: "running" as const,
      depth: 1,
      startedAt: "2026-08-09T01:00:00.000Z",
    };
    ledger.upsert(
      {
        productId: "example",
        userId: "user-1",
        sessionId: "session-1",
        rootRunId: "run-example",
      },
      run,
    );
    ledger.upsert(
      {
        productId: "english",
        userId: "user-1",
        sessionId: "session-1",
        rootRunId: "run-english",
      },
      run,
    );
    ledger.close();

    const restarted = new SubAgentRunLedger(dbPath);
    ledgers.push(restarted);
    expect(restarted.reconcileInterruptedRuns()).toBe(2);
    expect(
      restarted.recent({ productId: "example", userId: "user-1", sessionId: "session-1" }),
    ).toEqual([expect.objectContaining({ rootRunId: "run-example", status: "interrupted" })]);
    expect(
      restarted.recent({ productId: "english", userId: "user-1", sessionId: "session-1" }),
    ).toEqual([expect.objectContaining({ rootRunId: "run-english", status: "interrupted" })]);
    expect(
      restarted.recent({ productId: "example", userId: "user-2", sessionId: "session-1" }),
    ).toEqual([]);
  });
});

function makeLedger(): SubAgentRunLedger {
  const ledger = new SubAgentRunLedger(join(makeDirectory(), "runs.db"));
  ledgers.push(ledger);
  return ledger;
}

function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "kernifold-sub-agent-ledger-test-"));
  directories.push(directory);
  return directory;
}
