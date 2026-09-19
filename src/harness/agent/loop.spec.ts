import { jsonSchema, simulateReadableStream, tool, type ModelMessage, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./events.js";
import { agentLoop } from "./loop.js";
import type { AgentToolRuntime, AgentToolSelection } from "./tool-runtime.js";

const TEST_USAGE = {
  inputTokens: {
    total: 3,
    noCache: 3,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

class FakeAgentToolRuntime implements AgentToolRuntime {
  readonly selections: (AgentToolSelection | undefined)[] = [];

  constructor(private readonly tools: ToolSet = {}) {}

  getTools(selection?: AgentToolSelection): ToolSet {
    this.selections.push(selection);
    return this.tools;
  }
}

describe("agentLoop", () => {
  it("executes multiple tool calls in one step and feeds every result into the next step", async () => {
    const executedValues: string[] = [];
    const runtime = new FakeAgentToolRuntime({
      echo: tool({
        description: "echo",
        inputSchema: jsonSchema<{ value: string }>({
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        }),
        execute: ({ value }) => {
          executedValues.push(value);
          return Promise.resolve(`echo:${value}`);
        },
      }),
    });
    let modelCalls = 0;
    const model = new MockLanguageModelV4({
      doStream: (options) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return Promise.resolve(
            toolCallStream([
              { id: "call-1", name: "echo", input: { value: "alpha" } },
              { id: "call-2", name: "echo", input: { value: "beta" } },
            ]),
          );
        }

        const prompt = JSON.stringify(options.prompt);
        expect(prompt).toContain("echo:alpha");
        expect(prompt).toContain("echo:beta");
        return Promise.resolve(textStream("两个工具都已完成"));
      },
    });

    const result = await agentLoop({
      model,
      toolRuntime: runtime,
      messages: [{ role: "user", content: "echo twice" }],
      system: "test",
    });

    expect(result.text).toBe("两个工具都已完成");
    expect(result.termination).toBe("completed");
    expect(result.stats).toMatchObject({ steps: 2, toolCalls: 2, retries: 0 });
    expect(executedValues.toSorted()).toEqual(["alpha", "beta"]);
    expect(runtime.selections).toHaveLength(2);
  });

  it("returns normalized usage and emits the typed completed lifecycle", async () => {
    const events: AgentEvent[] = [];
    const messages: ModelMessage[] = [{ role: "user", content: "测试" }];
    const model = new MockLanguageModelV4({
      doStream: () => Promise.resolve(textStream("完成")),
    });

    const result = await agentLoop({
      model,
      toolRuntime: new FakeAgentToolRuntime(),
      messages,
      system: "test",
      eventSink: (event) => {
        events.push(event);
      },
    });

    expect(result).toMatchObject({
      text: "完成",
      termination: "completed",
      stats: {
        steps: 1,
        toolCalls: 0,
        retries: 0,
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    });
    expect(result.appendedMessages).toHaveLength(1);
    expect(messages).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "step_started",
      "text_delta",
      "step_finished",
      "run_finished",
    ]);
    expect(events.at(-1)).toEqual({ type: "run_finished", result });
  });

  it("does not invoke the model or resolve tools when maxSteps is zero", async () => {
    const runtime = new FakeAgentToolRuntime();
    const events: AgentEvent[] = [];
    const doStream = vi.fn(() => {
      throw new Error("model should not run");
    });
    const model = new MockLanguageModelV4({
      doStream,
    });

    const result = await agentLoop({
      model,
      toolRuntime: runtime,
      messages: [{ role: "user", content: "测试" }],
      system: "test",
      maxSteps: 0,
      eventSink: (event) => {
        events.push(event);
      },
    });

    expect(doStream).not.toHaveBeenCalled();
    expect(runtime.selections).toEqual([]);
    expect(result).toEqual({
      appendedMessages: [],
      text: "",
      termination: "max_steps",
      stats: {
        steps: 0,
        toolCalls: 0,
        retries: 0,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    });
    expect(events.map((event) => event.type)).toEqual(["run_started", "run_finished"]);
  });

  it("terminates as soon as a model step completes without a tool call", async () => {
    const doStream = vi.fn(() => Promise.resolve(textStream("done")));
    const model = new MockLanguageModelV4({ doStream });

    const result = await agentLoop({
      model,
      toolRuntime: new FakeAgentToolRuntime(),
      messages: [{ role: "user", content: "finish" }],
      system: "test",
      maxSteps: 5,
    });

    expect(doStream).toHaveBeenCalledOnce();
    expect(result.termination).toBe("completed");
    expect(result.stats.steps).toBe(1);
  });
});

function toolCallStream(
  calls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
) {
  return {
    stream: simulateReadableStream({
      chunks: [
        ...calls.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.id,
          toolName: call.name,
          input: JSON.stringify(call.input),
        })),
        {
          type: "finish" as const,
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          logprobs: undefined,
          usage: TEST_USAGE,
        },
      ],
    }),
  };
}

function textStream(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "text-start" as const, id: "text" },
        { type: "text-delta" as const, id: "text", delta: text },
        { type: "text-end" as const, id: "text" },
        {
          type: "finish" as const,
          finishReason: { unified: "stop" as const, raw: undefined },
          logprobs: undefined,
          usage: TEST_USAGE,
        },
      ],
    }),
  };
}
