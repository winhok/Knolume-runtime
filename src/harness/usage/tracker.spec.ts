import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  UsageTracker,
  computeCost,
  normalizeUsage,
  PRICE_TABLE,
  type StepUsage,
} from "./tracker.js";
const dirs: string[] = [];
const usage: StepUsage = {
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 50,
  cacheWriteTokens: 10,
};
afterEach(() => {
  delete PRICE_TABLE["test-priced"];
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
it("aggregates records and persists independently readable JSONL", () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-usage-"));
  dirs.push(dir);
  const path = join(dir, "nested", "usage.jsonl");
  const tracker = new UsageTracker(path);
  expect(tracker.totals()).toMatchObject({ steps: 0, cost: 0, hitRate: 0 });
  const first = tracker.record("deepseek-v4-flash", usage);
  const second = tracker.record("deepseek-v4-flash", {
    ...usage,
    cacheStorageTokenHours: 10,
  });
  expect(tracker.recent(1)).toEqual([second]);
  expect(tracker.totals()).toMatchObject({
    steps: 2,
    inputTokens: 200,
    outputTokens: 40,
    cacheReadTokens: 100,
    cacheWriteTokens: 20,
    cacheStorageTokenHours: 10,
    currency: "USD",
    hitRate: 50 / 160,
  });
  expect(tracker.totals().cost).toBeCloseTo(first.cost + second.cost);
  expect(
    readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  ).toEqual([first, second]);
  expect(() => tracker.record("qwen3.7-plus-2026-05-26", usage)).toThrow(
    "Cannot mix",
  );
  expect(tracker.totals().steps).toBe(2);
});
it("uses inclusive tier boundaries, cache tokens and storage fees with fixture pricing", () => {
  PRICE_TABLE["test-priced"] = {
    currency: "USD",
    cacheStorage: 2,
    tiers: [
      {
        upToInputTokens: 160,
        input: 1,
        output: 2,
        cacheRead: 0.1,
        cacheWrite: 1.5,
      },
      {
        upToInputTokens: 200,
        input: 3,
        output: 4,
        cacheRead: 0.5,
        cacheWrite: 5,
      },
    ],
  };
  expect(
    computeCost("test-priced", { ...usage, cacheStorageTokenHours: 10 }),
  ).toBeCloseTo(180 / 1e6);
  expect(
    computeCost("test-priced", { ...usage, inputTokens: 101 }),
  ).toBeCloseTo(458 / 1e6);
  expect(() =>
    computeCost("test-priced", { ...usage, inputTokens: 201 }),
  ).toThrow("No pricing tier");
  expect(() => computeCost("unknown-model", usage)).toThrow("Unknown model");
  const tracker = new UsageTracker();
  tracker.record("test-priced", usage);
  expect(tracker.totals().baselineCost).toBeCloseTo(200 / 1e6);
  expect(tracker.totals().savedCost).toBeCloseTo(40 / 1e6);
});
it("normalizes absent usage, cache details and prevents negative uncached counts", () => {
  expect(normalizeUsage(null)).toEqual({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  expect(
    normalizeUsage({
      inputTokens: 5,
      outputTokens: undefined,
      totalTokens: 5,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: 8,
        cacheWriteTokens: 2,
      },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    }),
  ).toEqual({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 8,
    cacheWriteTokens: 2,
  });
});
