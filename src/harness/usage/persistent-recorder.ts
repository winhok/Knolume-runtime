import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PRICE_TABLE, computeCost, type StepUsage, type UsageRecorder } from "./tracker.js";

export interface UsageRecordResult extends StepUsage {
  ts: number;
  model: string;
  cost?: number;
  currency?: "USD" | "CNY";
}

export class PersistentUsageRecorder implements UsageRecorder {
  constructor(private readonly logPath: string) {
    mkdirSync(dirname(logPath), { recursive: true });
  }

  record(model: string, usage: StepUsage): UsageRecordResult {
    const pricing = PRICE_TABLE[model];
    const record: UsageRecordResult = {
      ts: Date.now(),
      model,
      ...usage,
      ...(pricing ? { cost: computeCost(model, usage), currency: pricing.currency } : {}),
    };
    appendFileSync(this.logPath, `${JSON.stringify(record)}\n`);
    return record;
  }
}
