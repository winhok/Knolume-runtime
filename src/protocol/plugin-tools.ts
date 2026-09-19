import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);

export const pluginToolCapabilitySchema = z.enum([
  "read",
  "write",
  "execute",
  "delegate",
  "external",
  "state",
]);

export const pluginToolResourceSchema = z.enum(["workspace"]);

export const pluginToolDescriptorSchema = z
  .object({
    name: identifierSchema,
    description: z.string().min(1).max(10_000),
    inputSchema: z.record(z.string(), z.unknown()),
    capabilities: z.array(pluginToolCapabilitySchema).min(1),
    requiredResources: z.array(pluginToolResourceSchema).default([]),
    isConcurrencySafe: z.boolean().default(false),
    holdsExecutionLock: z.boolean().optional(),
    maxResultChars: z.number().int().positive().optional(),
  })
  .strict();

export type PluginToolDescriptor = z.infer<typeof pluginToolDescriptorSchema>;

export const pluginToolDiscoveryResponseSchema = z
  .object({ tools: z.array(pluginToolDescriptorSchema) })
  .strict()
  .superRefine(({ tools }, context) => {
    const names = new Set<string>();
    for (const [index, tool] of tools.entries()) {
      if (names.has(tool.name)) {
        context.addIssue({
          code: "custom",
          path: ["tools", index, "name"],
          message: "Plugin Tool names must be unique",
        });
      }
      names.add(tool.name);
    }
  });

export type PluginToolDiscoveryResponse = z.infer<typeof pluginToolDiscoveryResponseSchema>;
