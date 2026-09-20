import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);

export const createAgentRunRequestSchema = z
  .object({
    clientRequestId: identifierSchema,
    userId: identifierSchema,
    sessionId: identifierSchema,
    agentId: identifierSchema,
    executionProfileId: identifierSchema,
    workspaceId: identifierSchema.optional(),
    message: z.string().min(1).max(100_000),
    instructions: z.string().max(100_000).optional(),
  })
  .strict();

export type CreateAgentRunRequest = z.infer<typeof createAgentRunRequestSchema>;

export const agentRunStatusSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "finalizing",
  "finished",
  "failed",
  "cancelled",
  "interrupted",
]);

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const agentRunTerminationSchema = z.enum(["completed", "loop_detected", "max_steps"]);
export type AgentRunTermination = z.infer<typeof agentRunTerminationSchema>;

export const agentRunOutcomeSchema = z.enum(["completed", "incomplete", "permission_denied"]);
export type AgentRunOutcome = z.infer<typeof agentRunOutcomeSchema>;

export const agentRunCompletionDataSchema = z.object({
  result: z.string(),
  termination: agentRunTerminationSchema,
  outcome: agentRunOutcomeSchema,
  stats: z.unknown().optional(),
  traceId: identifierSchema.optional(),
});
export type AgentRunCompletionData = z.infer<typeof agentRunCompletionDataSchema>;

export const createAgentRunResponseSchema = z.object({
  runId: identifierSchema,
  status: agentRunStatusSchema,
  eventsUrl: z.string().startsWith("/"),
});

export type CreateAgentRunResponse = z.infer<typeof createAgentRunResponseSchema>;

export const agentRunStatusResponseSchema = z.object({
  runId: identifierSchema,
  status: agentRunStatusSchema,
  eventsUrl: z.string().startsWith("/"),
});

export type AgentRunStatusResponse = z.infer<typeof agentRunStatusResponseSchema>;

export const agentEventTypeSchema = z.enum([
  "run_queued",
  "run_started",
  "run_cancelling",
  "run_cancelled",
  "approval_required",
  "approval_resolved",
  "step_started",
  "step_finished",
  "step_continuing",
  "tool_started",
  "tool_finished",
  "tool_failed",
  "loop_detected",
  "retry_scheduled",
  "cache_usage",
  "guardrail_checked",
  "text_delta",
  "run_finished",
  "run_failed",
]);

export type AgentEventType = z.infer<typeof agentEventTypeSchema>;

export const agentEventEnvelopeSchema = z.object({
  id: z.string().min(1),
  runId: identifierSchema,
  sequence: z.number().int().positive(),
  type: agentEventTypeSchema,
  timestamp: z.iso.datetime(),
  data: z.record(z.string(), z.unknown()),
});

export type AgentEventEnvelope = z.infer<typeof agentEventEnvelopeSchema>;
