import type { AgentLoopStats } from "../agent/events.js";
import type { AgentToolCapability } from "../agent/tool-runtime.js";

export interface SubAgentConfig {
  maxSpawnDepth: number;
  maxConcurrent: number;
  defaultTimeout: number;
}

export interface SubAgentProfile {
  description: string;
  systemPrompt: string;
  capabilities: readonly AgentToolCapability[];
  tools?: readonly string[] | undefined;
}

export const DEFAULT_SUB_AGENT_CONFIG: SubAgentConfig = {
  maxSpawnDepth: 1,
  maxConcurrent: 3,
  defaultTimeout: 60_000,
};

export interface SpawnRequest {
  task: string;
  profile?: string;
  tools?: string[];
  timeout?: number;
}

export interface SubAgentRun {
  id: string;
  parentRunId?: string;
  parentTraceId?: string;
  task: string;
  profile: string;
  status: "running" | "completed" | "error" | "timeout" | "cancelled";
  depth: number;
  startedAt: string;
  finishedAt?: string;
  result?: string;
  error?: string;
  stats?: AgentLoopStats;
  tracePath?: string;
}
