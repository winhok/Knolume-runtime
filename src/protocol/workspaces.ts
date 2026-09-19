import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);

export const createWorkspaceRequestSchema = z
  .object({
    clientRequestId: identifierSchema,
    userId: identifierSchema,
  })
  .strict();

export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const workspaceAllocationStateSchema = z.enum(["creating", "active", "deleting", "deleted"]);

export const workspaceAllocationSchema = z.object({
  workspaceId: identifierSchema,
  userId: identifierSchema,
  state: workspaceAllocationStateSchema,
  createdAt: z.iso.datetime(),
});

export type WorkspaceAllocationResponse = z.infer<typeof workspaceAllocationSchema>;
