import { z } from "zod";
import type { ExecutableTool, ToolSelection } from "./registry.js";

export interface ToolSearchTarget {
  searchTools(
    query: string,
    selection?: ToolSelection,
  ): Array<{
    name: string;
    description: string;
    inputJsonSchema?: Record<string, unknown>;
  }>;
}

export function createToolSearchTool(
  registry: ToolSearchTarget,
  selection?: ToolSelection,
): ExecutableTool<{ query: string }> {
  return {
    name: "tool_search",
    description:
      "获取延迟工具的完整定义。传入工具名（从系统提示的延迟工具列表中选取），返回该工具的完整参数 Schema",
    inputSchema: z.object({ query: z.string() }).strict(),
    capabilities: ["read"],
    isConcurrencySafe: true,
    execute: ({ query }) => {
      const results = registry.searchTools(query, selection);
      if (results.length === 0) return Promise.resolve(`没有找到工具: ${query}`);
      return Promise.resolve(
        results.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputJsonSchema,
        })),
      );
    },
  };
}
