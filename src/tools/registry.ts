import type { z } from "zod";

export type ToolCapability = "read" | "write" | "execute" | "delegate" | "external" | "state";

export type ToolResource = "workspace";

export interface ToolExecutionContext {
  runId: string;
  productId: string;
  userId: string;
  workspace?: {
    id: string;
    rootPath: string;
  };
  abortSignal?: AbortSignal;
}

export interface ToolDefinition<TInput = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  /** Provider-facing JSON Schema, used when a Tool is discovered dynamically. */
  inputJsonSchema?: Record<string, unknown>;
  capabilities: readonly ToolCapability[];
  requiredResources?: readonly ToolResource[];
  isConcurrencySafe?: boolean;
  holdsExecutionLock?: boolean;
  maxResultChars?: number;
  shouldDefer?: boolean;
  searchHint?: string;
}

export interface ToolSelection {
  allowedCapabilities?: ReadonlySet<ToolCapability>;
  allowedTools?: ReadonlySet<string>;
  deniedCapabilities?: ReadonlySet<ToolCapability>;
}

export interface ExecutableTool<TInput = Record<string, unknown>> extends ToolDefinition<TInput> {
  execute(input: TInput, context: ToolExecutionContext): Promise<unknown>;
}

export interface ToolsetDefinition {
  id: string;
  toolNames: readonly string[];
}

export class ToolRegistry<TTool extends ToolDefinition = ToolDefinition> {
  private readonly tools = new Map<string, TTool>();
  private readonly defaultView = new ToolView(this);

  constructor(tools: readonly TTool[] = []) {
    this.register(...tools);
  }

  register(...tools: readonly TTool[]): void {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Tool is already registered: ${tool.name}`);
      }
      this.tools.set(tool.name, tool);
    }
  }

  unregister(name: string): boolean {
    this.defaultView.forget(name);
    return this.tools.delete(name);
  }

  get(name: string): TTool | undefined {
    return this.tools.get(name);
  }

  require(name: string): TTool {
    const tool = this.get(name);
    if (!tool) throw new Error(`Tool is not registered: ${name}`);
    return tool;
  }

  resolve(names: readonly string[]): TTool[] {
    return names.map((name) => this.require(name));
  }

  getAll(): TTool[] {
    return [...this.tools.values()];
  }

  getActiveTools(selection?: ToolSelection): TTool[] {
    return this.defaultView.getActiveTools(selection);
  }

  getDeferredToolSummary(selection?: ToolSelection): string {
    return this.defaultView.getDeferredToolSummary(selection);
  }

  searchTools(query: string, selection?: ToolSelection): TTool[] {
    return this.defaultView.searchTools(query, selection);
  }

  countTokenEstimate(selection?: ToolSelection): {
    active: number;
    deferred: number;
    total: number;
  } {
    return this.defaultView.countTokenEstimate(selection);
  }

  createView(): ToolView<TTool> {
    return new ToolView(this);
  }

  matchesSelection(tool: ToolDefinition, selection?: ToolSelection): boolean {
    if (!selection) return true;
    if (selection.allowedTools && !selection.allowedTools.has(tool.name)) return false;
    if (
      selection.deniedCapabilities &&
      tool.capabilities.some((capability) => selection.deniedCapabilities?.has(capability))
    ) {
      return false;
    }
    return (
      !selection.allowedCapabilities ||
      tool.capabilities.every((capability) => selection.allowedCapabilities?.has(capability))
    );
  }
}

/** A per-Agent discovery cursor over an immutable Run-level Tool registry. */
export class ToolView<TTool extends ToolDefinition = ToolDefinition> {
  private readonly discoveredTools = new Set<string>();

  constructor(private readonly registry: ToolRegistry<TTool>) {}

  forget(name: string): void {
    this.discoveredTools.delete(name);
  }

  getActiveTools(selection?: ToolSelection): TTool[] {
    return this.registry
      .getAll()
      .filter(
        (tool) =>
          (!tool.shouldDefer || this.discoveredTools.has(tool.name)) &&
          this.registry.matchesSelection(tool, selection),
      );
  }

  getDeferredToolSummary(selection?: ToolSelection): string {
    const deferred = this.registry
      .getAll()
      .filter(
        (tool) =>
          tool.shouldDefer &&
          !this.discoveredTools.has(tool.name) &&
          this.registry.matchesSelection(tool, selection),
      );
    if (deferred.length === 0) return "";
    const lines = deferred.map((tool) => {
      const hint = tool.searchHint ? ` — ${tool.searchHint}` : "";
      return `  - ${tool.name}${hint}`;
    });
    return `\n以下工具可用，但需要先通过 tool_search 搜索获取完整定义：\n${lines.join("\n")}`;
  }

  searchTools(query: string, selection?: ToolSelection): TTool[] {
    const results: TTool[] = [];
    for (const name of query
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      const tool = this.registry.get(name);
      if (tool && tool.name !== "tool_search" && this.registry.matchesSelection(tool, selection)) {
        this.discoveredTools.add(tool.name);
        results.push(tool);
      }
    }
    return results;
  }

  countTokenEstimate(selection?: ToolSelection): {
    active: number;
    deferred: number;
    total: number;
  } {
    let active = 0;
    let deferred = 0;
    for (const tool of this.registry.getAll()) {
      if (!this.registry.matchesSelection(tool, selection)) continue;
      const tokens = Math.ceil(
        JSON.stringify({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputJsonSchema,
        }).length / 4,
      );
      if (tool.shouldDefer && !this.discoveredTools.has(tool.name)) deferred += tokens;
      else active += tokens;
    }
    return { active, deferred, total: active + deferred };
  }
}

export class ToolsetRegistry {
  private readonly toolsets = new Map<string, ToolsetDefinition>();

  constructor(toolsets: readonly ToolsetDefinition[] = []) {
    for (const toolset of toolsets) {
      if (this.toolsets.has(toolset.id)) {
        throw new Error(`Toolset is already registered: ${toolset.id}`);
      }
      this.toolsets.set(toolset.id, toolset);
    }
  }

  require(id: string): ToolsetDefinition {
    const toolset = this.toolsets.get(id);
    if (!toolset) throw new Error(`Toolset is not registered: ${id}`);
    return toolset;
  }
}
