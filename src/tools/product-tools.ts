import type { PluginToolDescriptor } from "../protocol/index.js";
import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

/** Adapts typed Product Tool metadata without coupling it to MCP or Harness. */
export function createProductToolDefinitions(
  descriptors: readonly PluginToolDescriptor[],
): ToolDefinition[] {
  return descriptors.map((descriptor) => ({
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: z.record(z.string(), z.unknown()),
    inputJsonSchema: descriptor.inputSchema,
    capabilities: descriptor.capabilities,
    requiredResources: descriptor.requiredResources,
    isConcurrencySafe: descriptor.isConcurrencySafe,
    holdsExecutionLock: descriptor.holdsExecutionLock,
    maxResultChars: descriptor.maxResultChars,
  }));
}
