import type { ToolSet } from "ai";
import type { AgentLoopOptions } from "../agent/loop.js";
import type { AgentEvent, AgentLoopResult } from "../agent/events.js";
import {
  abortable,
  checkGuardrails,
  GuardrailError,
  type GuardrailInput,
} from "./index.js";

/** Transactional content delivery. Tools remain real side effects after the input gate opens. */
export async function runGuardedLoop(
  options: AgentLoopOptions,
  core: (options: AgentLoopOptions) => Promise<AgentLoopResult>,
): Promise<AgentLoopResult> {
  const config = options.guardrails!;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    ...(options.abortSignal ? [options.abortSignal] : []),
  ]);
  const messages = structuredClone(options.messages);
  const events: AgentEvent[] = [];
  const callbacks: Array<() => Promise<void>> = [];
  const maxBuffer = config.maxBufferChars ?? 2_000_000;
  const cancellationTimeout = config.cancellationTimeoutMs ?? 2_000;
  if (
    !Number.isSafeInteger(maxBuffer) ||
    maxBuffer <= 0 ||
    !Number.isSafeInteger(cancellationTimeout) ||
    cancellationTimeout <= 0
  ) {
    throw new GuardrailError("input", "invalid");
  }
  let bufferChars = 0;
  let closed = false;
  let failure: GuardrailError | undefined;
  const executions = new Set<Promise<unknown>>();
  let running: Promise<AgentLoopResult> | undefined;
  const stop = (error: GuardrailError) => {
    failure ??= error;
    controller.abort(failure);
    return failure;
  };
  const reserve = (value: unknown) => {
    bufferChars += JSON.stringify(value)?.length ?? 0;
    if (bufferChars > maxBuffer)
      throw stop(new GuardrailError("output", "buffer_limit"));
  };
  const audit = async (
    value: Parameters<NonNullable<AgentLoopOptions["eventSink"]>>[0],
  ) => {
    if (!closed) await options.eventSink?.(value);
  };
  const check = async (
    rules: Parameters<typeof checkGuardrails>[0],
    value: GuardrailInput,
  ) => {
    try {
      await checkGuardrails(rules, value, config, signal, (entry) =>
        audit({ type: "guardrail_checked", audit: entry }),
      );
    } catch (error) {
      if (error instanceof GuardrailError) throw stop(error);
      signal.throwIfAborted();
      throw stop(new GuardrailError(value.stage, "error"));
    }
  };
  const input = check(config.input, {
    stage: "input",
    messages,
    text: userText(messages),
  });
  // Attach immediately; parallel model setup may throw before awaiting this promise.
  void input.catch(() => {});
  const wrapTools = (tools: ToolSet): ToolSet =>
    Object.fromEntries(
      Object.entries(tools).map(([name, definition]) => {
        if (definition.type === "provider")
          throw stop(new GuardrailError("tool_input", "unsupported_tool"));
        const wrapped = { ...definition };
        // These callbacks may have side effects too; keep them behind the same gate.
        for (const key of [
          "onInputStart",
          "onInputDelta",
          "onInputAvailable",
        ] as const) {
          const callback = definition[key];
          if (callback)
            Object.assign(wrapped, {
              [key]: async (...args: unknown[]) => {
                await abortable(input, signal);
                signal.throwIfAborted();
                return (callback as (...args: unknown[]) => unknown)(...args);
              },
            });
        }
        if (definition.execute) {
          const execute = definition.execute;
          wrapped.execute = (args, execution) => {
            const operation = (async () => {
              await abortable(input, signal);
              signal.throwIfAborted();
              await check(config.toolInput, {
                stage: "tool_input",
                messages,
                text: "",
                tool: name,
                input: args,
              });
              signal.throwIfAborted();
              let output = await execute(args, {
                ...execution,
                abortSignal: signal,
              });
              // Do not expose intermediate tool output before the output check.
              if (
                output &&
                typeof output === "object" &&
                Symbol.asyncIterator in output
              ) {
                let last: unknown;
                for await (const part of output as AsyncIterable<unknown>) {
                  signal.throwIfAborted();
                  reserve(part);
                  last = part;
                }
                output = last;
              }
              signal.throwIfAborted();
              await check(config.toolOutput, {
                stage: "tool_output",
                messages,
                text: "",
                tool: name,
                input: args,
                output,
              });
              return output;
            })().catch((error: unknown) => {
              signal.throwIfAborted();
              if (error instanceof GuardrailError) throw error;
              // The SDK converts tool exceptions into model-visible results.
              // Keep raw provider/tool error text out of the next model prompt.
              throw new Error("Tool execution failed");
            });
            executions.add(operation);
            void operation.then(
              () => executions.delete(operation),
              () => executions.delete(operation),
            );
            return operation;
          };
        }
        if (definition.toModelOutput) {
          const convert = definition.toModelOutput;
          wrapped.toModelOutput = async (
            args: Parameters<typeof convert>[0],
          ) => {
            await abortable(input, signal);
            let output;
            try {
              output = await convert(args);
            } catch {
              signal.throwIfAborted();
              throw new Error("Tool output conversion failed");
            }
            await check(config.toolOutput, {
              stage: "tool_output",
              messages,
              text: "",
              tool: name,
              output,
            });
            return output;
          };
        }
        return [name, wrapped];
      }),
    );
  try {
    signal.throwIfAborted();
    if (config.inputMode !== "parallel") await input;
    running = core({
      ...options,
      guardrails: undefined,
      messages,
      abortSignal: signal,
      // Raw candidate content must never reach a trace or persistence callback.
      trace: undefined,
      toolRuntime: {
        getTools: (selection) =>
          wrapTools(options.toolRuntime.getTools(selection)),
      },
      prepareNextStep: async (...args) => {
        await abortable(input, signal);
        signal.throwIfAborted();
        await options.prepareNextStep?.(...args);
      },
      onStepUsage: async (...args) => {
        if (closed) return;
        signal.throwIfAborted();
        reserve(args);
        const copy = structuredClone(args);
        callbacks.push(async () => {
          await options.onStepUsage?.(...copy);
        });
      },
      eventSink: async (event) => {
        if (closed) return;
        signal.throwIfAborted();
        if (event.type === "run_failed") return;
        reserve(event);
        events.push(structuredClone(event));
      },
    });
    void running.catch(() => {});
    const [result] = await Promise.all([abortable(running, signal), input]);
    signal.throwIfAborted();
    if (failure) throw failure;
    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.text)
      .join("");
    await check(config.output, {
      stage: "output",
      messages: result.appendedMessages,
      text: text || result.text,
    });
    signal.throwIfAborted();
    // Replay persistence only after every configured check has passed.
    for (const callback of callbacks) {
      signal.throwIfAborted();
      await callback();
    }
    if (options.trace) {
      await options.trace.recordStepCompleted({
        step: result.stats.steps,
        text: result.text,
        outputMessages: result.appendedMessages,
        usage: result.stats.usage,
      });
    }
    signal.throwIfAborted();
    options.messages.push(...result.appendedMessages);
    for (const event of events) {
      signal.throwIfAborted();
      await options.eventSink?.(event);
    }
    closed = true;
    return result;
  } catch (error) {
    closed = true;
    controller.abort(error);
    let terminal = failure ?? error;
    if (running) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settled = await Promise.race([
        Promise.allSettled([running, ...executions]).then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), cancellationTimeout);
        }),
      ]);
      clearTimeout(timer);
      if (!settled)
        terminal = new GuardrailError(
          failure?.stage ?? "input",
          "cancellation_incomplete",
        );
    }
    events.length = 0;
    callbacks.length = 0;
    await options.eventSink?.({ type: "run_failed", error: terminal });
    throw terminal;
  }
}

function userText(messages: readonly import("ai").ModelMessage[]): string {
  const message = messages.findLast((entry) => entry.role === "user");
  return typeof message?.content === "string"
    ? message.content
    : JSON.stringify(message?.content ?? "");
}
