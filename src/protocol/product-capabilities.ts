import { z } from "zod";
import { createAgentRunResponseSchema } from "./agent-runs.js";

const identifier = z.string().trim().min(1).max(128);
export const productCapabilityScopeSchema = z.object({
  userId: identifier,
  sessionId: identifier,
  workspaceId: identifier.optional(),
});

export const memoryCapabilityRequestSchema = productCapabilityScopeSchema
  .extend({
    operation: z.enum(["list", "lint", "search"]),
    query: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operation === "search" && !value.query) {
      context.addIssue({ code: "custom", path: ["query"], message: "query is required" });
    }
    if (value.operation === "lint" && !value.workspaceId) {
      context.addIssue({
        code: "custom",
        path: ["workspaceId"],
        message: "workspaceId is required for lint",
      });
    }
  });
const memoryFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => {
    return !value.includes("/") && !value.includes("\\") && value.endsWith(".md");
  });
const workspaceRelativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => {
    return (
      value === value.normalize("NFC") &&
      !value.startsWith("/") &&
      !/^[A-Za-z]:/.test(value) &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    );
  });
export const memoryCapabilityResponseSchema = z.object({
  entries: z.array(
    z.object({
      filename: memoryFilenameSchema,
      name: z.string(),
      description: z.string(),
      type: z.enum(["user", "feedback", "project", "reference"]),
      score: z.number().optional(),
    }),
  ),
  warnings: z.array(
    z.object({
      filename: memoryFilenameSchema,
      issues: z.array(
        z.object({
          kind: z.enum(["never_used", "duplicate_name", "non_portable_path"]),
          message: z.string(),
        }),
      ),
    }),
  ),
  pathResults: z.array(
    z.object({
      filename: memoryFilenameSchema,
      relativePath: workspaceRelativePathSchema,
      status: z.enum(["exists", "missing", "forbidden"]),
    }),
  ),
});

export const ragStatusRequestSchema = productCapabilityScopeSchema.strict();
export const ragStatusResponseSchema = z.object({
  enabled: z.boolean(),
  chunks: z.number().int().nonnegative(),
  sources: z.array(z.string()),
});
export const ragIngestRequestSchema = productCapabilityScopeSchema
  .extend({
    workspaceId: identifier,
    relativePath: z.string().trim().min(1).max(4_096),
  })
  .strict();
export const ragIngestResponseSchema = z.object({
  source: z.string(),
  status: z.enum(["imported", "skipped"]),
  chunks: z.number().int().nonnegative(),
});

export const skillsCapabilityRequestSchema = productCapabilityScopeSchema.strict();
export const skillsCapabilityResponseSchema = z.object({
  skills: z.array(
    z.object({ name: identifier, description: z.string(), whenToUse: z.string().optional() }),
  ),
});

const toolCapabilitySchema = z.enum(["read", "write", "execute", "delegate", "external", "state"]);

export const contextCapabilityRequestSchema = productCapabilityScopeSchema
  .extend({
    agentId: identifier,
    executionProfileId: identifier,
  })
  .strict();
const contextToolInventorySchema = z
  .object({
    names: z.array(identifier),
    activeNames: z.array(identifier),
    deferredNames: z.array(identifier),
    descriptionTokens: z.number().int().nonnegative(),
    activeTokens: z.number().int().nonnegative(),
    deferredTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    estimated: z.literal(true),
  })
  .superRefine((value, context) => {
    const expectedNames = [...new Set([...value.activeNames, ...value.deferredNames])];
    if (
      value.names.length !== expectedNames.length ||
      value.names.some((name, index) => name !== expectedNames[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["names"],
        message: "names must be the ordered unique union of activeNames and deferredNames",
      });
    }
    if (value.descriptionTokens !== value.activeTokens) {
      context.addIssue({
        code: "custom",
        path: ["descriptionTokens"],
        message: "descriptionTokens must equal activeTokens",
      });
    }
    if (value.totalTokens !== value.activeTokens + value.deferredTokens) {
      context.addIssue({
        code: "custom",
        path: ["totalTokens"],
        message: "totalTokens must equal activeTokens plus deferredTokens",
      });
    }
  });
export const contextCapabilityResponseSchema = z.object({
  agentId: identifier,
  executionProfileId: identifier,
  modelProfileId: identifier,
  toolsetId: identifier,
  allowedCapabilities: z.array(toolCapabilitySchema),
  model: z.object({
    provider: z.string().min(1).nullable(),
    modelId: z.string().min(1).nullable(),
    nominalWindowTokens: z.number().int().positive().nullable(),
  }),
  projection: z.object({
    effectiveWindowTokens: z.number().int().positive(),
    autocompactThresholdTokens: z.number().int().positive(),
    usedTokens: z.number().int().nonnegative(),
    estimatedBreakdownTokens: z.number().int().nonnegative(),
    autocompactReserveTokens: z.number().int().nonnegative(),
    safetyReserveTokens: z.number().int().nonnegative().nullable(),
    providerObservedPromptTokens: z.number().int().nonnegative().nullable(),
    estimated: z.literal(true),
    slices: z.array(
      z.object({
        name: z.string().min(1),
        tokens: z.number().int().nonnegative(),
        estimated: z.literal(true),
      }),
    ),
  }),
  tools: contextToolInventorySchema,
  resources: z.object({
    workspaceBound: z.boolean(),
    historyMessages: z.number().int().nonnegative(),
    memoryEntries: z.number().int().nonnegative(),
    ragEnabled: z.boolean(),
    ragChunks: z.number().int().nonnegative(),
    ragSources: z.array(z.string()),
    skills: z.number().int().nonnegative(),
  }),
  renderedView: z.string().min(1),
});

export const hooksCapabilityRequestSchema = productCapabilityScopeSchema.strict();
export const hooksCapabilityResponseSchema = z.object({
  pre: z.array(identifier),
  post: z.array(identifier),
});

export const agentsCapabilityRequestSchema = productCapabilityScopeSchema
  .extend({
    agentId: identifier,
    executionProfileId: identifier,
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
const subAgentProfileSchema = z.object({
  id: identifier,
  description: z.string(),
  capabilities: z.array(toolCapabilitySchema),
  tools: z.array(identifier).optional(),
});
export const agentsCapabilityResponseSchema = z.object({
  agentId: identifier,
  executionProfileId: identifier,
  delegation: z.discriminatedUnion("enabled", [
    z.object({ enabled: z.literal(false) }),
    z.object({
      enabled: z.literal(true),
      maxSpawnDepth: z.number().int().nonnegative(),
      maxConcurrent: z.number().int().positive(),
      defaultTimeoutMs: z.number().int().positive(),
    }),
  ]),
  profiles: z.array(subAgentProfileSchema),
  recentRuns: z.array(
    z.object({
      rootRunId: identifier,
      childRunId: identifier,
      profile: identifier,
      depth: z.number().int().positive(),
      taskPreview: z.string().max(200),
      status: z.enum(["running", "completed", "error", "timeout", "cancelled", "interrupted"]),
      startedAt: z.iso.datetime(),
      finishedAt: z.iso.datetime().optional(),
      resultPreview: z.string().max(400).optional(),
      errorPreview: z.string().max(200).optional(),
      stats: z
        .object({
          steps: z.number().int().nonnegative(),
          toolCalls: z.number().int().nonnegative(),
          retries: z.number().int().nonnegative(),
          usage: z.object({
            inputTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
            cacheReadTokens: z.number().int().nonnegative(),
            cacheWriteTokens: z.number().int().nonnegative(),
          }),
        })
        .optional(),
    }),
  ),
  runHistoryAvailable: z.literal(true),
});

export const dreamCapabilityRequestSchema = productCapabilityScopeSchema
  .extend({
    clientRequestId: identifier,
    workspaceId: identifier,
  })
  .strict();
export const dreamCapabilityResponseSchema = createAgentRunResponseSchema;

const usageRecordSchema = z.object({
  timestamp: z.iso.datetime(),
  model: z.string(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheWriteTokens: z.number().nonnegative(),
  cost: z.number().nonnegative().optional(),
  currency: z.enum(["USD", "CNY"]).optional(),
});
export const diagnosticsUsageResponseSchema = z.object({
  totals: z.object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    cacheReadTokens: z.number().nonnegative(),
    cacheWriteTokens: z.number().nonnegative(),
    steps: z.number().int().nonnegative(),
    runFiles: z.number().int().nonnegative(),
    invalidRecords: z.number().int().nonnegative(),
    cacheHitRate: z.number().min(0).max(1),
    costByCurrency: z.object({
      USD: z.number().nonnegative().optional(),
      CNY: z.number().nonnegative().optional(),
    }),
  }),
  recent: z.array(usageRecordSchema),
});

export type MemoryCapabilityRequest = z.infer<typeof memoryCapabilityRequestSchema>;
export type MemoryCapabilityResponse = z.infer<typeof memoryCapabilityResponseSchema>;
export type RagStatusRequest = z.infer<typeof ragStatusRequestSchema>;
export type RagStatusResponse = z.infer<typeof ragStatusResponseSchema>;
export type RagIngestRequest = z.infer<typeof ragIngestRequestSchema>;
export type RagIngestResponse = z.infer<typeof ragIngestResponseSchema>;
export type SkillsCapabilityRequest = z.infer<typeof skillsCapabilityRequestSchema>;
export type SkillsCapabilityResponse = z.infer<typeof skillsCapabilityResponseSchema>;
export type ContextCapabilityRequest = z.infer<typeof contextCapabilityRequestSchema>;
export type ContextCapabilityResponse = z.infer<typeof contextCapabilityResponseSchema>;
export type HooksCapabilityRequest = z.infer<typeof hooksCapabilityRequestSchema>;
export type HooksCapabilityResponse = z.infer<typeof hooksCapabilityResponseSchema>;
export type AgentsCapabilityRequest = z.infer<typeof agentsCapabilityRequestSchema>;
export type AgentsCapabilityResponse = z.infer<typeof agentsCapabilityResponseSchema>;
export type DreamCapabilityRequest = z.infer<typeof dreamCapabilityRequestSchema>;
export type DreamCapabilityResponse = z.infer<typeof dreamCapabilityResponseSchema>;
export type DiagnosticsUsageResponse = z.infer<typeof diagnosticsUsageResponseSchema>;
