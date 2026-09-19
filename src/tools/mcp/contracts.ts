import { z } from "zod";
import { DEFAULT_MAX_RESULT_CHARS } from "../execution-pipeline.js";
import type { ExecutableTool } from "../registry.js";

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolClientPort {
  connect: () => Promise<void>;
  listTools: () => Promise<McpToolDescriptor[]>;
  callTool: (name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
  close: () => Promise<void>;
}

export function createMcpToolDefinitions(
  serverName: string,
  tools: readonly McpToolDescriptor[],
  client: McpToolClientPort,
): ExecutableTool[] {
  return tools.map((tool) => ({
    name: `mcp__${serverName}__${tool.name}`,
    description: `[MCP:${serverName}] ${tool.description}`,
    inputSchema: z.record(z.string(), z.unknown()),
    inputJsonSchema: tool.inputSchema,
    capabilities: ["external"],
    isConcurrencySafe: false,
    maxResultChars: DEFAULT_MAX_RESULT_CHARS,
    shouldDefer: true,
    searchHint: `${serverName} ${tool.name} ${tool.description}`,
    execute: (input, context) => client.callTool(tool.name, input, context.abortSignal),
  }));
}
