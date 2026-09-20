import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";

export type GuardrailStage = "input" | "output" | "tool_input" | "tool_output";
export type GuardrailOutcome =
  "passed" | "blocked" | "would_block" | "timeout" | "error" | "invalid";
export type GuardrailFailure =
  | Exclude<GuardrailOutcome, "passed" | "would_block">
  | "buffer_limit"
  | "unsupported_tool"
  | "cancellation_incomplete";

/** Fixed metadata only: checker return values and thrown errors are never exposed. */
export interface GuardrailAudit {
  stage: GuardrailStage;
  name: string;
  mode: "enforce" | "shadow";
  outcome: GuardrailOutcome;
  policyVersion?: string;
  requestHash?: string;
  durationMs?: number;
  addedTokens?: number;
}
export interface GuardrailInput {
  stage: GuardrailStage;
  messages: readonly ModelMessage[];
  text: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
}
export interface Guardrail {
  name: string;
  mode?: "enforce" | "shadow";
  timeoutMs?: number;
  /** Only explicit non-mandatory output rules can be repaired/reviewed. */
  reviewable?: boolean;
  execute: (
    args: GuardrailInput & { context: unknown; signal: AbortSignal },
  ) =>
    | { tripwireTriggered: boolean; reviewable?: boolean; addedTokens?: number }
    | PromiseLike<{
        tripwireTriggered: boolean;
        reviewable?: boolean;
        addedTokens?: number;
      }>;
}
export interface OutputRecoveryInput {
  text: string;
  rule: string;
  requestHash: string;
  signal: AbortSignal;
}

export interface AgentGuardrails {
  policyVersion?: string;
  repairOutput?: (input: OutputRecoveryInput) => Promise<string>;
  reviewOutput?: (input: OutputRecoveryInput) => Promise<boolean>;
  recoveryTimeoutMs?: number;
  input?: readonly Guardrail[];
  output?: readonly Guardrail[];
  toolInput?: readonly Guardrail[];
  toolOutput?: readonly Guardrail[];
  inputMode?: "blocking" | "parallel";
  /** Host-owned identity/policy data, never taken from tool arguments. */
  context?: unknown;
  timeoutMs?: number;
  cancellationTimeoutMs?: number;
  maxBufferChars?: number;
}
export class GuardrailError extends Error {
  readonly name = "GuardrailError";
  constructor(
    readonly stage: GuardrailStage,
    readonly outcome: GuardrailFailure,
    readonly ruleName?: string,
    readonly canReview = false,
  ) {
    super(`Guardrail ${stage}: ${outcome}`);
  }
}

export function abortable<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function checkGuardrails(
  rules: readonly Guardrail[] | undefined,
  value: GuardrailInput,
  config: AgentGuardrails,
  signal: AbortSignal,
  audit: (event: GuardrailAudit) => void | Promise<void>,
): Promise<void> {
  for (const rule of rules ?? []) {
    signal.throwIfAborted();
    if (
      rule.mode !== undefined &&
      rule.mode !== "shadow" &&
      rule.mode !== "enforce"
    ) {
      throw new GuardrailError(value.stage, "invalid");
    }
    const timeoutMs = rule.timeoutMs ?? config.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
      throw new GuardrailError(value.stage, "invalid");
    const startedAt = performance.now();
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const timer = setTimeout(
      () => controller.abort(new GuardrailError(value.stage, "timeout")),
      timeoutMs,
    );
    let outcome: GuardrailOutcome;
    let canReview = false;
    let addedTokens: number | undefined;
    try {
      const result = await abortable(
        Promise.resolve().then(() =>
          rule.execute({
            ...structuredClone(value),
            context: config.context,
            signal: combined,
          }),
        ),
        combined,
      );
      if (Number.isSafeInteger(result?.addedTokens) && result.addedTokens! >= 0)
        addedTokens = result.addedTokens;
      canReview = rule.reviewable === true && result?.reviewable !== false;
      if (
        !result ||
        typeof result.tripwireTriggered !== "boolean" ||
        (result.reviewable !== undefined &&
          typeof result.reviewable !== "boolean")
      )
        outcome = "invalid";
      else outcome = result.tripwireTriggered ? "blocked" : "passed";
    } catch {
      signal.throwIfAborted();
      outcome = controller.signal.aborted ? "timeout" : "error";
    } finally {
      clearTimeout(timer);
    }
    const mode = rule.mode ?? "enforce";
    await audit({
      stage: value.stage,
      ...(addedTokens !== undefined ? { addedTokens } : {}),
      name: /^[a-zA-Z0-9_.:-]{1,100}$/.test(rule.name)
        ? rule.name
        : "host-rule",
      ...(config.policyVersion
        ? {
            policyVersion: /^[a-zA-Z0-9_.:-]{1,100}$/.test(config.policyVersion)
              ? config.policyVersion
              : "host-policy",
          }
        : {}),
      requestHash: createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex"),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      mode,
      outcome:
        mode === "shadow" && outcome === "blocked" ? "would_block" : outcome,
    });
    signal.throwIfAborted();
    if (outcome !== "passed" && mode === "enforce")
      throw new GuardrailError(value.stage, outcome, rule.name, canReview);
  }
}
