export type ToolHookAction = "allow" | "block" | "modify";

export interface ToolHookResult {
  action: ToolHookAction;
  reason?: string;
  modifiedInput?: unknown;
  modifiedOutput?: unknown;
}

export type PreToolHook = (
  toolName: string,
  input: unknown,
) => ToolHookResult | Promise<ToolHookResult>;

export type PostToolHook = (
  toolName: string,
  input: unknown,
  output: unknown,
) => ToolHookResult | Promise<ToolHookResult>;

export interface ToolHookFailure {
  phase: "pre" | "post";
  hookName: string;
  error: unknown;
}

/** Runs ordered Tool extensions without coupling Tool execution to a product. */
export class ToolHookPipeline {
  private readonly preHooks: Array<{ name: string; hook: PreToolHook }> = [];
  private readonly postHooks: Array<{ name: string; hook: PostToolHook }> = [];

  constructor(private readonly onFailure?: (failure: ToolHookFailure) => void) {}

  registerPre(name: string, hook: PreToolHook): void {
    this.assertUnique(name);
    this.preHooks.push({ name, hook });
  }

  registerPost(name: string, hook: PostToolHook): void {
    this.assertUnique(name);
    this.postHooks.push({ name, hook });
  }

  async runPre(toolName: string, input: unknown): Promise<ToolHookResult> {
    let currentInput = input;
    let modified = false;
    for (const { name, hook } of this.preHooks) {
      try {
        const result = await hook(toolName, currentInput);
        if (result.action === "block") return result;
        if (result.action === "modify" && result.modifiedInput !== undefined) {
          currentInput = result.modifiedInput;
          modified = true;
        }
      } catch (error) {
        this.onFailure?.({ phase: "pre", hookName: name, error });
      }
    }
    return modified ? { action: "modify", modifiedInput: currentInput } : { action: "allow" };
  }

  async runPost(toolName: string, input: unknown, output: unknown): Promise<ToolHookResult> {
    let currentOutput = output;
    for (const { name, hook } of this.postHooks) {
      try {
        const result = await hook(toolName, input, currentOutput);
        if (result.action === "block") return result;
        if (result.action === "modify" && result.modifiedOutput !== undefined) {
          currentOutput = result.modifiedOutput;
        }
      } catch (error) {
        this.onFailure?.({ phase: "post", hookName: name, error });
      }
    }
    return { action: "allow", modifiedOutput: currentOutput };
  }

  list(): { pre: string[]; post: string[] } {
    return {
      pre: this.preHooks.map(({ name }) => name),
      post: this.postHooks.map(({ name }) => name),
    };
  }

  private assertUnique(name: string): void {
    if (
      this.preHooks.some((entry) => entry.name === name) ||
      this.postHooks.some((entry) => entry.name === name)
    ) {
      throw new Error(`Tool hook is already registered: ${name}`);
    }
  }
}
