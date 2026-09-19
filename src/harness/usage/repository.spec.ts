import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageReadRepository } from "./repository.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("UsageReadRepository", () => {
  it("reads safe records in reverse chronological order and reports corrupt lines", async () => {
    const directory = makeTempDir();
    writeFileSync(
      join(directory, "run.jsonl"),
      [
        JSON.stringify(record(1000, "model-old")),
        "not-json",
        JSON.stringify({ ...record(2000, "model-new"), cost: 0.5, currency: "CNY" }),
      ].join("\n"),
      "utf8",
    );

    const result = await new UsageReadRepository(directory).read(1500);

    expect(result.fileCount).toBe(1);
    expect(result.invalidRecordCount).toBe(1);
    expect(result.records).toEqual([
      expect.objectContaining({ ts: 2000, model: "model-new", cost: 0.5, currency: "CNY" }),
    ]);
  });

  it("returns an empty result for a subject without usage data", async () => {
    await expect(new UsageReadRepository(join(makeTempDir(), "missing")).read()).resolves.toEqual({
      records: [],
      fileCount: 0,
      invalidRecordCount: 0,
    });
  });
});

function record(ts: number, model: string) {
  return {
    ts,
    model,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheWriteTokens: 0,
  };
}

function makeTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "kernifold-usage-repository-test-"));
  tempDirs.push(directory);
  return directory;
}
