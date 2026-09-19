import type { ToolSet } from "ai";

export type AgentToolCapability = "read" | "write" | "execute" | "delegate" | "external" | "state";

export interface AgentToolSelection {
  allowedCapabilities?: ReadonlySet<AgentToolCapability>;
  allowedTools?: ReadonlySet<string>;
  deniedCapabilities?: ReadonlySet<AgentToolCapability>;
  readOnlyOnly?: boolean;
}

/**
 * The Agent loop only needs a fresh AI SDK tool view for each model step.
 * Tool registration, authorization, approval, and execution stay behind this port.
 */
export interface AgentToolRuntime {
  getTools(selection?: AgentToolSelection): ToolSet;
  getDeferredToolSummary?(selection?: AgentToolSelection): string;
}
