import type { LanguageModel, ModelMessage } from "ai";
import {
  CompactionCircuitBreaker,
  microcompact,
  pruneOldestContext,
  summarize,
} from "./compressor.js";
import { applyDefense, TokenTracker, type DefenseResult } from "./defense.js";
import { promptTokensFromUsage, type StepUsage } from "../usage/tracker.js";

export const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_TOKENS = 950_000;
export const DEFAULT_AUTOCOMPACT_THRESHOLD_TOKENS = 200_000;

export interface RunContextProjectionOptions {
  effectiveContextWindowTokens?: number;
  autocompactThresholdTokens?: number;
  clearableTools?: ReadonlySet<string>;
}

export interface ContextCompactionResult {
  compacted: boolean;
  clearedToolResults: number;
  summarizedMessages: number;
}

/**
 * Mutable, run-local projection of the durable Session Ledger transcript.
 *
 * The source transcript is intentionally copied and never rewritten. Defense
 * and compaction only affect the messages sent to the model for this run.
 */
export class RunContextProjection {
  readonly messages: ModelMessage[];

  private readonly tracker: TokenTracker;
  private readonly effectiveContextWindowTokens: number;
  private readonly autocompactThresholdTokens: number;
  private summary = "";
  private readonly clearableTools: ReadonlySet<string>;
  private readonly compactionBreaker = new CompactionCircuitBreaker();

  constructor(sourceMessages: readonly ModelMessage[], options: RunContextProjectionOptions = {}) {
    const effectiveContextWindowTokens =
      options.effectiveContextWindowTokens ?? DEFAULT_EFFECTIVE_CONTEXT_WINDOW_TOKENS;
    this.effectiveContextWindowTokens = effectiveContextWindowTokens;
    this.autocompactThresholdTokens =
      options.autocompactThresholdTokens ?? DEFAULT_AUTOCOMPACT_THRESHOLD_TOKENS;
    this.clearableTools = new Set(options.clearableTools ?? []);
    this.messages = [...sourceMessages];
    this.tracker = new TokenTracker(effectiveContextWindowTokens);
    this.tracker.addMessages(this.messages);
  }

  async prepare(model: LanguageModel): Promise<{
    defense: DefenseResult;
    compaction: ContextCompactionResult;
  }> {
    // Durable history currently has no per-message wall-clock metadata. An
    // empty timestamp map deliberately disables TTL pruning for that history;
    // size and tool-result defenses still apply.
    const defense = applyDefense(this.messages, new Map(), this.effectiveContextWindowTokens);
    this.replaceMessages(defense.messages);
    return { defense, compaction: await this.compactIfNeeded(model) };
  }

  async recordStep(
    model: LanguageModel,
    usage: StepUsage,
    responseMessages: readonly ModelMessage[],
    needsFollowUp: boolean,
  ): Promise<ContextCompactionResult> {
    const promptTokens = promptTokensFromUsage(usage);
    if (promptTokens > 0) this.tracker.updateFromAPI(promptTokens);
    this.tracker.addMessages([...responseMessages]);

    return needsFollowUp
      ? this.compactIfNeeded(model)
      : { compacted: false, clearedToolResults: 0, summarizedMessages: 0 };
  }

  get estimatedTokens(): number {
    return this.tracker.estimatedTokens;
  }

  private async compactIfNeeded(model: LanguageModel): Promise<ContextCompactionResult> {
    if (this.tracker.estimatedTokens <= this.autocompactThresholdTokens) {
      return { compacted: false, clearedToolResults: 0, summarizedMessages: 0 };
    }

    const micro = microcompact(this.messages, this.clearableTools);
    this.replaceMessages(micro.messages);

    if (this.compactionBreaker.isOpen) {
      return this.applyDeterministicFallback(micro.cleared);
    }

    try {
      const compression = await summarize(model, this.messages, this.summary, {
        thresholdTokens: Math.max(1, Math.floor(this.autocompactThresholdTokens * 0.8)),
      });
      if (compression.compressedCount > 0) {
        this.summary = compression.summary;
        this.replaceMessages(compression.messages);
        this.compactionBreaker.recordSuccess();
      }
      return {
        compacted: micro.cleared > 0 || compression.compressedCount > 0,
        clearedToolResults: micro.cleared,
        summarizedMessages: compression.compressedCount,
      };
    } catch {
      this.compactionBreaker.recordFailure();
      return this.compactionBreaker.isOpen
        ? this.applyDeterministicFallback(micro.cleared)
        : {
            compacted: micro.cleared > 0,
            clearedToolResults: micro.cleared,
            summarizedMessages: 0,
          };
    }
  }

  private applyDeterministicFallback(clearedToolResults: number): ContextCompactionResult {
    const fallback = pruneOldestContext(
      this.messages,
      Math.max(1, Math.floor(this.autocompactThresholdTokens * 0.8)),
      this.summary,
    );
    if (fallback.compressedCount > 0) {
      this.summary = fallback.summary;
      this.replaceMessages(fallback.messages);
    }
    return {
      compacted: clearedToolResults > 0 || fallback.compressedCount > 0,
      clearedToolResults,
      summarizedMessages: fallback.compressedCount,
    };
  }

  private replaceMessages(nextMessages: ModelMessage[]): void {
    const before = [...this.messages];
    this.tracker.replaceMessages(before, nextMessages);
    this.messages.splice(0, this.messages.length, ...nextMessages);
  }
}
