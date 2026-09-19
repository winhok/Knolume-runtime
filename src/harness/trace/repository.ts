import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StepUsage } from "../usage/tracker.js";

const TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const MAX_TRACE_BYTES = 10 * 1024 * 1024;

export class InvalidTraceIdError extends Error {}
export class TraceDataCorruptError extends Error {}

export interface TraceStepDetails {
  step: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  usage?: StepUsage;
  toolNames: string[];
  attemptFailures: number;
  outputTextLength?: number;
}

export interface TraceDetails {
  traceId: string;
  sessionId?: string;
  model?: string;
  parentTraceId?: string;
  parentRunId?: string;
  startedAt?: string;
  finishedAt?: string;
  status: "completed" | "failed" | "cancelled" | "incomplete";
  durationMs?: number;
  hasError: boolean;
  steps: TraceStepDetails[];
}

export class TraceReadRepository {
  constructor(private readonly traceDirectory: string) {}

  async get(traceId: string): Promise<TraceDetails | undefined> {
    assertTraceId(traceId);
    const filePath = join(this.traceDirectory, `${traceId}.jsonl`);
    let size: number;
    try {
      const metadata = await lstat(filePath);
      if (!metadata.isFile()) throw new TraceDataCorruptError("Trace is not a regular file");
      size = metadata.size;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    if (size > MAX_TRACE_BYTES) throw new TraceDataCorruptError("Trace exceeds read limit");

    const content = await readFile(filePath, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_TRACE_BYTES) {
      throw new TraceDataCorruptError("Trace exceeds read limit");
    }
    const events = parseJsonLines(content);
    return projectTrace(traceId, events);
  }
}

function assertTraceId(traceId: string): void {
  if (!TRACE_ID.test(traceId)) throw new InvalidTraceIdError("Invalid trace identifier");
}

function parseJsonLines(content: string): Record<string, unknown>[] {
  try {
    return content
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const value: unknown = JSON.parse(line);
        if (!isRecord(value)) throw new TraceDataCorruptError("Trace event is not an object");
        return value;
      });
  } catch (error) {
    if (error instanceof TraceDataCorruptError) throw error;
    throw new TraceDataCorruptError("Trace contains invalid JSON");
  }
}

function projectTrace(traceId: string, events: Record<string, unknown>[]): TraceDetails {
  const started = events.find((event) => event.type === "trace_started");
  if (!started || started.traceId !== traceId) {
    throw new TraceDataCorruptError("Trace identity does not match the requested identifier");
  }
  const finished = [...events].reverse().find((event) => event.type === "trace_finished");
  const steps = new Map<number, TraceStepDetails>();

  for (const event of events) {
    const step = safeNonNegativeInteger(event.step);
    if (step === undefined || step < 1) continue;
    const current = steps.get(step) ?? {
      step,
      toolNames: [],
      attemptFailures: 0,
    };
    if (event.type === "step_started") current.startedAt = safeString(event.timestamp);
    if (event.type === "step_attempt_failed") current.attemptFailures += 1;
    if (event.type === "step_completed") {
      current.completedAt = safeString(event.timestamp);
      current.durationMs = safeNonNegativeInteger(event.durationMs);
      current.usage = safeUsage(event.usage);
      current.toolNames = toolNames(event.output);
      const output = isRecord(event.output) ? event.output : undefined;
      if (typeof output?.text === "string") current.outputTextLength = output.text.length;
    }
    steps.set(step, current);
  }

  return {
    traceId,
    sessionId: safeString(started.sessionId),
    model: safeString(started.model),
    parentTraceId: safeString(started.parentTraceId),
    parentRunId: safeString(started.parentRunId),
    startedAt: safeString(started.timestamp),
    finishedAt: safeString(finished?.timestamp),
    status: safeStatus(finished?.status),
    durationMs: safeNonNegativeInteger(finished?.durationMs),
    hasError: finished?.error !== undefined,
    steps: [...steps.values()].sort((left, right) => left.step - right.step),
  };
}

function toolNames(output: unknown): string[] {
  if (!isRecord(output) || !Array.isArray(output.messages)) return [];
  const names = new Set<string>();
  for (const message of output.messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (isRecord(part) && part.type === "tool-call" && typeof part.toolName === "string") {
        names.add(part.toolName);
      }
    }
  }
  return [...names];
}

function safeUsage(value: unknown): StepUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = safeNonNegativeInteger(value.inputTokens);
  const outputTokens = safeNonNegativeInteger(value.outputTokens);
  const cacheReadTokens = safeNonNegativeInteger(value.cacheReadTokens);
  const cacheWriteTokens = safeNonNegativeInteger(value.cacheWriteTokens);
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    cacheReadTokens === undefined ||
    cacheWriteTokens === undefined
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

function safeStatus(value: unknown): TraceDetails["status"] {
  return value === "completed" || value === "failed" || value === "cancelled"
    ? value
    : "incomplete";
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
