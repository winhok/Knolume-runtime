import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnAgent } from "../agents/spawn.js";
import { SubAgentRegistry } from "../agents/registry.js";
import {
  jsonSchema,
  simulateReadableStream,
  tool,
  type ModelMessage,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { agentLoop } from "../agent/loop.js";
import type { AgentEvent } from "../agent/events.js";
import {
  checkGuardrails,
  GuardrailError,
  type AgentGuardrails,
  type Guardrail,
} from "./index.js";

const usage = {
  inputTokens: {
    total: 3,
    noCache: 3,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};
function stream(text: string, call = false) {
  return {
    stream: simulateReadableStream({
      initialDelayInMs: 0,
      chunkDelayInMs: 0,
      chunks: [
        ...(call
          ? [
              {
                type: "tool-call" as const,
                toolCallId: "1",
                toolName: "act",
                input: "{}",
              },
            ]
          : [
              { type: "text-start" as const, id: "t" },
              { type: "text-delta" as const, id: "t", delta: text },
              { type: "text-end" as const, id: "t" },
            ]),
        {
          type: "finish" as const,
          finishReason: {
            unified: call ? ("tool-calls" as const) : ("stop" as const),
            raw: undefined,
          },
          usage,
        },
      ],
    }),
  };
}
function rule(
  tripwireTriggered: boolean,
  extra: Partial<Guardrail> = {},
): Guardrail {
  return { name: "test", execute: () => ({ tripwireTriggered }), ...extra };
}
function setup(guardrails: AgentGuardrails, call = false) {
  const events: AgentEvent[] = [];
  const execute = vi.fn(async () => "tool-output");
  const messages: ModelMessage[] = [{ role: "user", content: "hello" }];
  let calls = 0;
  const doStream = vi.fn(async (_options: { prompt: unknown }) =>
    stream("candidate-secret", call && calls++ === 0),
  );
  const onStepUsage = vi.fn();
  const trace = {
    recordStepStarted: vi.fn(),
    recordStepCompleted: vi.fn(),
    recordAttemptError: vi.fn(),
  };
  const options = {
    guardrails,
    model: new MockLanguageModelV4({ doStream }),
    messages,
    system: "test",
    toolRuntime: {
      getTools: () => ({
        act: tool({
          inputSchema: jsonSchema({ type: "object", properties: {} }),
          execute,
        }),
      }),
    },
    eventSink: (event: AgentEvent) => {
      events.push(event);
    },
    onStepUsage,
    trace: trace as unknown as NonNullable<
      Parameters<typeof agentLoop>[0]["trace"]
    >,
  };
  return { options, events, execute, messages, doStream, onStepUsage, trace };
}

describe("guarded agent loop", () => {
  it("does not expose raw tool exceptions to follow-up model prompts or events", async () => {
    const s = setup({}, true);
    s.execute.mockRejectedValue(new Error("private-tool-credential"));
    let step = 0;
    s.doStream.mockImplementation(async (options) => {
      expect(JSON.stringify(options.prompt)).not.toContain(
        "private-tool-credential",
      );
      return stream("safe answer", step++ === 0);
    });
    await expect(agentLoop(s.options)).resolves.toMatchObject({
      text: "safe answer",
    });
    expect(s.doStream).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(s.events)).not.toContain("private-tool-credential");
    expect(JSON.stringify(s.messages)).not.toContain("private-tool-credential");
  });
  it("inherits guards in child agents and keeps blocked output out of child traces", async () => {
    const directory = await mkdtemp(join(tmpdir(), "guardrail-child-"));
    try {
      const registry = new SubAgentRegistry();
      const output = await spawnAgent(
        { task: "safe task" },
        {
          model: new MockLanguageModelV4({
            doStream: async () => stream("candidate-secret"),
          }),
          createToolRuntime: () => ({ getTools: () => ({}) }),
          agentRegistry: registry,
          profiles: {
            general: {
              description: "test",
              systemPrompt: "test",
              capabilities: [],
            },
          },
          currentDepth: 0,
          traceDirectory: directory,
          guardrails: { output: [rule(true)] },
        },
      );
      expect(output).toContain("Guardrail output: blocked");
      expect(output).not.toContain("candidate-secret");
      for (const file of await readdir(directory))
        expect(await readFile(join(directory, file), "utf8")).not.toContain(
          "candidate-secret",
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("reports cancellation incomplete when a tool ignores the signal", async () => {
    const s = setup({ cancellationTimeoutMs: 10 }, true);
    const gate = Promise.withResolvers<string>();
    s.execute.mockImplementation(() => gate.promise);
    const controller = new AbortController();
    const run = agentLoop({ ...s.options, abortSignal: controller.signal });
    const assertion = expect(run).rejects.toMatchObject({
      outcome: "cancellation_incomplete",
    });
    await vi.waitFor(() => expect(s.execute).toHaveBeenCalledOnce());
    controller.abort(new DOMException("cancel", "AbortError"));
    await assertion;
    gate.resolve("late secret");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.stringify(s.events)).not.toContain("late secret");
    expect(s.messages).toHaveLength(1);
  });
  it("keeps speculative completion behind a slow input decision", async () => {
    const gate = Promise.withResolvers<{ tripwireTriggered: boolean }>();
    const s = setup({
      inputMode: "parallel",
      input: [rule(false, { execute: () => gate.promise })],
    });
    const run = agentLoop(s.options);
    await vi.waitFor(() => expect(s.doStream).toHaveBeenCalled());
    expect(s.events).toEqual([]);
    expect(s.messages).toHaveLength(1);
    gate.resolve({ tripwireTriggered: false });
    await run;
    expect(s.events.at(-1)?.type).toBe("run_finished");
  });
  it("checks intermediate assistant text as well as the final answer", async () => {
    const s = setup(
      {
        output: [
          rule(false, {
            execute: ({ text }) => ({
              tripwireTriggered: text.includes("candidate-secret"),
            }),
          }),
        ],
      },
      true,
    );
    await expect(agentLoop(s.options)).rejects.toMatchObject({
      stage: "output",
    });
    expect(s.messages).toHaveLength(1);
  });
  it("blocks input before starting the model", async () => {
    const s = setup({ input: [rule(true)] }, true);
    await expect(agentLoop(s.options)).rejects.toMatchObject({
      stage: "input",
      outcome: "blocked",
    });
    expect(s.doStream).not.toHaveBeenCalled();
    expect(s.execute).not.toHaveBeenCalled();
  });
  it("runs speculative inference but holds every tool until input passes", async () => {
    const gate = Promise.withResolvers<{ tripwireTriggered: boolean }>();
    const s = setup(
      {
        inputMode: "parallel",
        input: [rule(false, { execute: () => gate.promise })],
      },
      true,
    );
    const run = agentLoop(s.options);
    await vi.waitFor(() => expect(s.doStream).toHaveBeenCalled());
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.messages).toHaveLength(1);
    gate.resolve({ tripwireTriggered: false });
    await expect(run).resolves.toMatchObject({ text: "candidate-secret" });
    expect(s.execute).toHaveBeenCalledOnce();
  });
  it("discards speculative events, history, trace and callbacks on parallel rejection", async () => {
    const gate = Promise.withResolvers<{ tripwireTriggered: boolean }>();
    const s = setup(
      {
        inputMode: "parallel",
        input: [rule(false, { execute: () => gate.promise })],
      },
      true,
    );
    const run = agentLoop(s.options);
    const rejected = expect(run).rejects.toBeInstanceOf(GuardrailError);
    await vi.waitFor(() => expect(s.doStream).toHaveBeenCalled());
    gate.resolve({ tripwireTriggered: true });
    await rejected;
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.messages).toHaveLength(1);
    expect(s.onStepUsage).not.toHaveBeenCalled();
    expect(s.trace.recordStepCompleted).not.toHaveBeenCalled();
    expect(s.events.map((e) => e.type)).toEqual([
      "guardrail_checked",
      "run_failed",
    ]);
  });
  it("never exposes rejected output through events, trace, callbacks or history", async () => {
    const s = setup({ output: [rule(true)] });
    await expect(agentLoop(s.options)).rejects.toMatchObject({
      stage: "output",
      outcome: "blocked",
    });
    expect(JSON.stringify(s.events)).not.toContain("candidate-secret");
    expect(s.messages).toHaveLength(1);
    expect(s.onStepUsage).not.toHaveBeenCalled();
    expect(s.trace.recordStepCompleted).not.toHaveBeenCalled();
  });
  it("does not let SDK tool-error conversion swallow a tripwire", async () => {
    const s = setup({ toolInput: [rule(true)] }, true);
    await expect(agentLoop(s.options)).rejects.toMatchObject({
      stage: "tool_input",
      outcome: "blocked",
    });
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.doStream).toHaveBeenCalledOnce();
  });
  it("blocks tool results before the follow-up model call", async () => {
    const s = setup({ toolOutput: [rule(true)] }, true);
    await expect(agentLoop(s.options)).rejects.toMatchObject({
      stage: "tool_output",
      outcome: "blocked",
    });
    expect(s.execute).toHaveBeenCalledOnce();
    expect(s.doStream).toHaveBeenCalledOnce();
    expect(JSON.stringify(s.events)).not.toContain("tool-output");
  });
  it("shadow observes tripwires while preserving successful output", async () => {
    const s = setup({
      input: [rule(true, { mode: "shadow" })],
      output: [rule(false)],
    });
    await expect(agentLoop(s.options)).resolves.toMatchObject({
      text: "candidate-secret",
    });
    expect(s.events).toContainEqual({
      type: "guardrail_checked",
      audit: {
        durationMs: expect.any(Number),
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        stage: "input",
        name: "test",
        mode: "shadow",
        outcome: "would_block",
      },
    });
    expect(s.events.at(-1)?.type).toBe("run_finished");
    expect(s.messages).toHaveLength(2);
  });
  it("fails closed on malformed decisions and never exposes checker errors", async () => {
    for (const execute of [
      () => ({}) as { tripwireTriggered: boolean },
      () => {
        throw new Error("secret checker detail");
      },
    ]) {
      const s = setup({ input: [rule(false, { execute })] });
      await expect(agentLoop(s.options)).rejects.toBeInstanceOf(GuardrailError);
      expect(JSON.stringify(s.events)).not.toContain("secret checker detail");
      expect(s.doStream).not.toHaveBeenCalled();
    }
  });
  it("bounds hung checks and propagates external cancellation", async () => {
    const s = setup({
      input: [
        rule(false, { timeoutMs: 10, execute: () => new Promise(() => {}) }),
      ],
    });
    await expect(agentLoop(s.options)).rejects.toMatchObject({
      outcome: "timeout",
    });
    const controller = new AbortController();
    const s2 = setup({
      input: [rule(false, { execute: () => new Promise(() => {}) })],
    });
    const run = agentLoop({ ...s2.options, abortSignal: controller.signal });
    controller.abort(new DOMException("cancel", "AbortError"));
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
  it("bounds buffered content", async () => {
    const s = setup({ output: [rule(false)], maxBufferChars: 20 });
    await expect(agentLoop(s.options)).rejects.toMatchObject({
      outcome: "buffer_limit",
    });
    expect(s.messages).toHaveLength(1);
  });
  it("does not pass mutable run messages to a checker", async () => {
    const messages: ModelMessage[] = [{ role: "user", content: "original" }];
    await checkGuardrails(
      [
        rule(false, {
          execute: ({ messages }) => {
            (messages[0] as { content: string }).content = "changed";
            return { tripwireTriggered: false };
          },
        }),
      ],
      { stage: "input", text: "original", messages },
      {},
      new AbortController().signal,
      () => {},
    );
    expect(messages[0]?.content).toBe("original");
  });
});

describe("output recovery", () => {
  const advisory: Guardrail = {
    name: "advisory",
    reviewable: true,
    execute: ({ text }) => ({
      tripwireTriggered: text.includes("candidate-secret"),
    }),
  };
  it("repairs once, rechecks, and never replays rejected text", async () => {
    const repairOutput = vi.fn(async () => "safe answer");
    const s = setup({ output: [advisory], repairOutput });
    const result = await agentLoop(s.options);
    expect(result.text).toBe("safe answer");
    expect(repairOutput).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify([
        s.events,
        s.messages,
        s.trace.recordStepCompleted.mock.calls,
      ]),
    ).not.toContain("candidate-secret");
  });
  it("never repairs or reviews a mandatory or high-risk block", async () => {
    for (const output of [
      [rule(true)],
      [
        {
          ...advisory,
          execute: () => ({ tripwireTriggered: true, reviewable: false }),
        },
      ],
    ]) {
      const repairOutput = vi.fn(async () => "safe");
      const reviewOutput = vi.fn(async () => true);
      const s = setup({ output, repairOutput, reviewOutput });
      await expect(agentLoop(s.options)).rejects.toMatchObject({
        outcome: "blocked",
      });
      expect(repairOutput).not.toHaveBeenCalled();
      expect(reviewOutput).not.toHaveBeenCalled();
    }
  });
  it("rechecks mandatory rules against repaired content", async () => {
    const s = setup({
      output: [
        {
          name: "mandatory",
          execute: ({ text }) => ({ tripwireTriggered: text === "new-secret" }),
        },
        advisory,
      ],
      repairOutput: async () => "new-secret",
      reviewOutput: async () => true,
    });
    await expect(agentLoop(s.options)).rejects.toMatchObject({
      outcome: "blocked",
    });
    expect(s.messages).toHaveLength(1);
    expect(JSON.stringify(s.events)).not.toContain("new-secret");
  });
  it("binds review to candidate hash, consumes only approval and bounds waiting", async () => {
    const reviewOutput = vi.fn(
      async (_input: import("./index.js").OutputRecoveryInput) => true,
    );
    const s = setup({ output: [advisory], reviewOutput });
    expect((await agentLoop(s.options)).text).toBe("candidate-secret");
    expect(reviewOutput.mock.calls[0]?.[0]).toMatchObject({
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      rule: "advisory",
    });
    const blocked = setup({
      output: [advisory],
      reviewOutput: async () => new Promise(() => {}),
      recoveryTimeoutMs: 10,
    });
    await expect(agentLoop(blocked.options)).rejects.toMatchObject({
      outcome: "timeout",
    });
    expect(blocked.messages).toHaveLength(1);
  });
});

it("rejects ambiguous review rule names and malformed review eligibility", async () => {
  const duplicate = setup({
    output: [
      rule(true, { reviewable: true }),
      rule(true, { reviewable: true }),
    ],
    reviewOutput: async () => true,
  });
  await expect(agentLoop(duplicate.options)).rejects.toMatchObject({
    outcome: "invalid",
  });
  const malformed = setup({
    output: [
      rule(true, {
        reviewable: true,
        execute: () =>
          ({ tripwireTriggered: true, reviewable: "false" }) as never,
      }),
    ],
    reviewOutput: async () => true,
  });
  await expect(agentLoop(malformed.options)).rejects.toMatchObject({
    outcome: "invalid",
  });
});
