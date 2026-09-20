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
  execute: (
    args: GuardrailInput & { context: unknown; signal: AbortSignal },
  ) =>
    | { tripwireTriggered: boolean }
    | PromiseLike<{ tripwireTriggered: boolean }>;
}
export interface AgentGuardrails {
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
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const timer = setTimeout(
      () => controller.abort(new GuardrailError(value.stage, "timeout")),
      timeoutMs,
    );
    let outcome: GuardrailOutcome;
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
      if (!result || typeof result.tripwireTriggered !== "boolean")
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
      name: rule.name,
      mode,
      outcome:
        mode === "shadow" && outcome === "blocked" ? "would_block" : outcome,
    });
    signal.throwIfAborted();
    if (outcome !== "passed" && mode === "enforce")
      throw new GuardrailError(value.stage, outcome);
  }
}
