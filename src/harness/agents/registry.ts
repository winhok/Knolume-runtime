import type { SubAgentConfig, SubAgentRun } from "./types.js";
import { DEFAULT_SUB_AGENT_CONFIG } from "./types.js";
import type { SubAgentRunObserver } from "./ledger.js";

export class SubAgentRegistry {
  private readonly runs = new Map<string, SubAgentRun>();
  private readonly config: SubAgentConfig;
  private idCounter = 0;

  constructor(
    config?: Partial<SubAgentConfig>,
    private readonly observer?: SubAgentRunObserver,
  ) {
    this.config = { ...DEFAULT_SUB_AGENT_CONFIG, ...config };
  }

  generateId(): string {
    return `sub-${++this.idCounter}-${Date.now().toString(36).slice(-4)}`;
  }

  canSpawn(currentDepth: number): { ok: boolean; reason?: string } {
    if (currentDepth >= this.config.maxSpawnDepth) {
      return {
        ok: false,
        reason: `已达最大嵌套深度 ${this.config.maxSpawnDepth}`,
      };
    }

    const activeCount = this.getActiveRuns().length;
    if (activeCount >= this.config.maxConcurrent) {
      return {
        ok: false,
        reason: `已达最大并发数 ${this.config.maxConcurrent}，等待现有任务完成`,
      };
    }

    return { ok: true };
  }

  register(run: SubAgentRun): void {
    this.observer?.onRunChanged(run);
    this.runs.set(run.id, run);
  }

  complete(id: string, result: string, stats?: SubAgentRun["stats"]): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.status = "completed";
    run.result = result;
    if (stats) run.stats = stats;
    run.finishedAt = new Date().toISOString();
    this.observer?.onRunChanged(run);
  }

  attachTrace(id: string, tracePath: string): void {
    const run = this.runs.get(id);
    if (run) run.tracePath = tracePath;
  }

  fail(id: string, error: string, timedOut = false): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.status = timedOut ? "timeout" : "error";
    run.error = error;
    run.finishedAt = new Date().toISOString();
    this.observer?.onRunChanged(run);
  }

  cancel(id: string, error: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.status = "cancelled";
    run.error = error;
    run.finishedAt = new Date().toISOString();
    this.observer?.onRunChanged(run);
  }

  get(id: string): SubAgentRun | undefined {
    return this.runs.get(id);
  }

  getActiveRuns(): SubAgentRun[] {
    return Array.from(this.runs.values()).filter((run) => run.status === "running");
  }

  getAllRuns(): SubAgentRun[] {
    return Array.from(this.runs.values());
  }

  getConfig(): SubAgentConfig {
    return this.config;
  }
}
