import { readFile, readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { PricingCurrency, StepUsage } from "./tracker.js";

const MAX_USAGE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_USAGE_TOTAL_BYTES = 32 * 1024 * 1024;

export interface UsageReadRecord extends StepUsage {
  ts: number;
  model: string;
  cost?: number;
  currency?: PricingCurrency;
}

export interface UsageReadResult {
  records: UsageReadRecord[];
  fileCount: number;
  invalidRecordCount: number;
}

export class UsageReadRepository {
  constructor(private readonly usageDirectory: string) {}

  async read(since?: number): Promise<UsageReadResult> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(this.usageDirectory, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch (error) {
      if (isMissing(error)) return { records: [], fileCount: 0, invalidRecordCount: 0 };
      throw error;
    }

    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"));
    const records: UsageReadRecord[] = [];
    let invalidRecordCount = 0;
    let totalBytes = 0;
    for (const file of files) {
      const filePath = join(this.usageDirectory, file.name);
      const size = (await stat(filePath)).size;
      totalBytes += size;
      if (size > MAX_USAGE_FILE_BYTES || totalBytes > MAX_USAGE_TOTAL_BYTES) {
        throw new Error("Usage data exceeds diagnostics read limit");
      }
      for (const line of (await readFile(filePath, "utf8")).split("\n")) {
        if (line.trim() === "") continue;
        const record = parseRecord(line);
        if (!record) {
          invalidRecordCount += 1;
          continue;
        }
        if (since === undefined || record.ts >= since) records.push(record);
      }
    }
    records.sort((left, right) => right.ts - left.ts);
    return { records, fileCount: files.length, invalidRecordCount };
  }
}

function parseRecord(line: string): UsageReadRecord | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value) || typeof value.model !== "string") return undefined;
    const ts = safeNonNegativeNumber(value.ts);
    const inputTokens = safeNonNegativeNumber(value.inputTokens);
    const outputTokens = safeNonNegativeNumber(value.outputTokens);
    const cacheReadTokens = safeNonNegativeNumber(value.cacheReadTokens);
    const cacheWriteTokens = safeNonNegativeNumber(value.cacheWriteTokens);
    if (
      ts === undefined ||
      inputTokens === undefined ||
      outputTokens === undefined ||
      cacheReadTokens === undefined ||
      cacheWriteTokens === undefined
    ) {
      return undefined;
    }
    const cost = safeNonNegativeNumber(value.cost);
    const currency =
      value.currency === "USD" || value.currency === "CNY" ? value.currency : undefined;
    return {
      ts,
      model: value.model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      ...(cost === undefined ? {} : { cost }),
      ...(currency === undefined ? {} : { currency }),
    };
  } catch {
    return undefined;
  }
}

function safeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
