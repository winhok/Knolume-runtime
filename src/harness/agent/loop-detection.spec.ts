import { describe, expect, it } from "vitest";
import { hashToolCall, ToolLoopDetector } from "./loop-detection.js";

describe("ToolLoopDetector", () => {
  it("hashes tool arguments independent of object key order", () => {
    expect(hashToolCall("lookup_record", { path: "a", mode: "text" })).toBe(
      hashToolCall("lookup_record", { mode: "text", path: "a" }),
    );
  });

  it("warns and then stops repeated calls before the agent step limit", () => {
    const detector = new ToolLoopDetector();

    for (let index = 0; index < 10; index++) {
      detector.recordCall("lookup_record", { path: "package.json" });
    }

    expect(detector.detect("lookup_record", { path: "package.json" })).toMatchObject({
      stuck: true,
      level: "warning",
      detector: "generic_repeat",
      count: 10,
    });

    for (let index = 10; index < 20; index++) {
      detector.recordCall("lookup_record", { path: "package.json" });
    }

    expect(detector.detect("lookup_record", { path: "package.json" })).toMatchObject({
      stuck: true,
      level: "critical",
      detector: "generic_repeat",
      count: 20,
    });
  });

  it("uses the per-run circuit breaker for varied tool calls", () => {
    const detector = new ToolLoopDetector();
    for (let index = 0; index < 30; index++) {
      detector.recordCall("lookup_record", { path: `file-${index}.ts` });
    }

    expect(detector.detect("grep", { pattern: "next" })).toMatchObject({
      stuck: true,
      level: "critical",
      detector: "global_circuit_breaker",
      count: 30,
    });
  });

  it("isolates loop history between concurrent agent runs", () => {
    const noisyRun = new ToolLoopDetector();
    const cleanRun = new ToolLoopDetector();
    for (let index = 0; index < 10; index++) {
      noisyRun.recordCall("lookup_record", { path: "same.ts" });
    }

    expect(noisyRun.detect("lookup_record", { path: "same.ts" }).stuck).toBe(true);
    expect(cleanRun.detect("lookup_record", { path: "same.ts" })).toEqual({ stuck: false });
  });

  it("clears only the selected run history", () => {
    const firstRun = new ToolLoopDetector();
    const secondRun = new ToolLoopDetector();
    for (let index = 0; index < 10; index++) {
      firstRun.recordCall("grep", { pattern: "first" });
      secondRun.recordCall("grep", { pattern: "second" });
    }

    firstRun.reset();

    expect(firstRun.detect("grep", { pattern: "first" })).toEqual({ stuck: false });
    expect(secondRun.detect("grep", { pattern: "second" }).stuck).toBe(true);
  });
});
