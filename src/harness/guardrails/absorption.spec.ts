import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GuardrailScheduler } from "./scheduler.js";
import {
  evaluateGuardrailCorpus,
  validatePromotionReport,
  validatePromotionEvidence,
  promotionReportHash,
} from "./evaluation.js";
import { SkillView } from "../skills/loader.js";

describe("absorbed runtime governance", () => {
  it("caps active work, bounds queue and removes cancelled waiters", async () => {
    const scheduler = new GuardrailScheduler(1, 1);
    const signal = new AbortController().signal;
    let release!: () => void;
    const first = scheduler.run(
      signal,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    let executed = false;
    const queued = scheduler.run(controller.signal, async () => {
      executed = true;
    });
    await expect(scheduler.run(signal, async () => {})).rejects.toThrow(
      "queue full",
    );
    controller.abort();
    await expect(queued).rejects.toBeDefined();
    expect(scheduler.pending).toBe(0);
    expect(scheduler.running).toBe(1);
    release();
    await first;
    expect(executed).toBe(false);
    expect(scheduler.running).toBe(0);
  });
  it("does not release an active slot until uncooperative work settles", async () => {
    const scheduler = new GuardrailScheduler(1, 0);
    const controller = new AbortController();
    let release!: () => void;
    const running = scheduler.run(
      controller.signal,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    controller.abort();
    expect(scheduler.running).toBe(1);
    await expect(
      scheduler.run(new AbortController().signal, async () => {}),
    ).rejects.toThrow();
    release();
    await running;
    expect(scheduler.running).toBe(0);
  });
  it("binds promotion to corpus, config and report while rejecting forged metrics and duplicate samples", async () => {
    const dir = mkdtempSync(join(tmpdir(), "promotion-"));
    try {
      const corpus = [
        {
          id: "benign",
          label: "benign" as const,
          text: "hello",
          expectedBlock: false,
        },
        {
          id: "attack",
          label: "attack" as const,
          text: "attack",
          expectedBlock: true,
          severity: "high" as const,
        },
      ];
      const report = await evaluateGuardrailCorpus({
        corpus,
        policyVersion: "v1",
        classifierConfig: { model: "fixture" },
        classify: async (sample) => ({
          blocked: sample.expectedBlock,
          latencyMs: 1,
          addedTokens: 2,
        }),
        runtimeEvidence: {
          cancellationAttempts: 1,
          cancellationSuccesses: 1,
          prematureOutputCount: 0,
          postBlockToolExecutions: 0,
        },
      });
      expect(validatePromotionReport(report).success).toBe(true);
      expect(
        validatePromotionReport({
          ...report,
          metrics: { ...report.metrics, addedTokens: 0 },
        }).success,
      ).toBe(false);
      expect(
        validatePromotionReport({
          ...report,
          samples: [report.samples[0], report.samples[0]],
        }).success,
      ).toBe(false);
      const reportFile = join(dir, "report.json");
      const corpusFile = join(dir, "corpus.json");
      writeFileSync(reportFile, JSON.stringify(report));
      writeFileSync(corpusFile, JSON.stringify(corpus));
      const binding = {
        reportFile,
        corpusFile,
        sha256: promotionReportHash(reportFile),
        policyVersion: "v1",
        classifierConfig: { model: "fixture" },
      };
      expect(validatePromotionEvidence(binding).sampleCount).toBe(2);
      expect(() =>
        validatePromotionEvidence({
          ...binding,
          classifierConfig: { model: "changed" },
        }),
      ).toThrow("config mismatch");
      writeFileSync(
        corpusFile,
        JSON.stringify([{ ...corpus[0], text: "changed" }, corpus[1]]),
      );
      expect(() => validatePromotionEvidence(binding)).toThrow(
        "corpus mismatch",
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("does not promote gaps or absent cancellation evidence", async () => {
    const report = await evaluateGuardrailCorpus({
      corpus: [
        {
          id: "bad",
          label: "attack",
          text: "bad",
          expectedBlock: true,
          severity: "critical",
        },
      ],
      policyVersion: "v1",
      classify: async () => ({ blocked: false, latencyMs: 1, addedTokens: 0 }),
      runtimeEvidence: {
        cancellationAttempts: 0,
        cancellationSuccesses: 0,
        prematureOutputCount: 0,
        postBlockToolExecutions: 0,
      },
    });
    expect(report.eligibleForEnforcement).toBe(false);
    expect(validatePromotionReport(report).success).toBe(false);
  });
  it("snapshots skill definitions and prevents mutation through getters", () => {
    const skill = {
      name: "test",
      description: "first",
      content: "one",
      dirPath: ".skills/test",
      disableModelInvocation: false,
      userInvocable: true,
    };
    const view = new SkillView([skill]);
    skill.content = "two";
    expect(view.get("test")?.content).toBe("one");
    expect(() => {
      view.get("test")!.content = "three";
    }).toThrow();
    expect(view.listUserInvocable()).toHaveLength(1);
  });
});
