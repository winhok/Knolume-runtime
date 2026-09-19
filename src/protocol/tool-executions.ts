import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);

export const toolExecutionRequestSchema = z
  .object({
    toolCallId: identifierSchema,
    runId: identifierSchema,
    productId: identifierSchema,
    userId: identifierSchema,
    workspaceId: identifierSchema.optional(),
    toolName: identifierSchema,
    arguments: z.record(z.string(), z.unknown()),
    deadlineAt: z.iso.datetime(),
  })
  .strict();

export type ToolExecutionRequest = z.infer<typeof toolExecutionRequestSchema>;

export const toolExecutionResponseSchema = z.discriminatedUnion("status", [
  z.object({
    toolCallId: identifierSchema,
    status: z.literal("succeeded"),
    output: z.string(),
  }),
  z.object({
    toolCallId: identifierSchema,
    status: z.literal("failed"),
    error: z.object({
      code: identifierSchema,
      message: z.string().min(1),
    }),
  }),
]);

export type ToolExecutionResponse = z.infer<typeof toolExecutionResponseSchema>;
