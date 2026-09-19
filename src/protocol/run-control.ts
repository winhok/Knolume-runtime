import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);

export const approvalDecisionRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
  })
  .strict();

export type ApprovalDecisionRequest = z.infer<typeof approvalDecisionRequestSchema>;

export const approvalDecisionResponseSchema = z.object({
  runId: identifierSchema,
  approvalId: identifierSchema,
  status: z.enum(["approved", "rejected"]),
});

export type ApprovalDecisionResponse = z.infer<typeof approvalDecisionResponseSchema>;

export const pendingApprovalDetailSchema = z
  .object({
    runId: identifierSchema,
    approvalId: identifierSchema,
    status: z.literal("pending"),
    tool: identifierSchema,
    input: z.record(z.string(), z.unknown()),
    reason: z.string().min(1).max(2_000),
  })
  .strict();

export type PendingApprovalDetail = z.infer<typeof pendingApprovalDetailSchema>;

export const cancelAgentRunResponseSchema = z.object({
  runId: identifierSchema,
  status: z.enum(["cancelling", "cancelled"]),
});

export type CancelAgentRunResponse = z.infer<typeof cancelAgentRunResponseSchema>;
