import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersistentUsageRecorder } from "./persistent-recorder.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("PersistentUsageRecorder", () => {
  it("persists raw usage for unknown OpenAI-compatible models without failing the Run", () => {
    const logPath = makeLogPath();
    const recorder = new PersistentUsageRecorder(logPath);
    const record = recorder.record("custom-model", {
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    expect(record.cost).toBeUndefined();
    expect(record.currency).toBeUndefined();
    expect(JSON.parse(readFileSync(logPath, "utf8"))).toMatchObject({
      model: "custom-model",
      inputTokens: 10,
      outputTokens: 2,
    });
  });

  it("adds cost and currency when a server pricing profile exists", () => {
    const logPath = makeLogPath();
    const record = new PersistentUsageRecorder(logPath).record("qwen3.7-plus-2026-05-26", {
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadTokens: 500,
      cacheWriteTokens: 0,
    });

    expect(record.cost).toBe(0.003);
    expect(record.currency).toBe("CNY");
  });
});

function makeLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "kernifold-usage-test-"));
  tempDirs.push(dir);
  return join(dir, "usage.jsonl");
}
