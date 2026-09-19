import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";

export type PromptSurface = "system" | "workspace" | "runtime";

export interface PromptContext {
  toolNames: ReadonlySet<string>;
  deferredToolSummary: string;
  sessionMessageCount: number;
  sessionId: string;
}

export interface PromptPipe {
  name: string;
  surface: PromptSurface;
  requiresTools?: readonly string[];
  render: (context: PromptContext) => string | null;
}

export interface PromptSection {
  name: string;
  surface: PromptSurface;
  text: string;
}

export interface PromptSnapshot {
  surface: Exclude<PromptSurface, "system">;
  text: string;
  digest: string;
}

export interface PromptAssembly {
  system: string;
  snapshots: PromptSnapshot[];
  sections: PromptSection[];
}

const EMPTY_SNAPSHOT_TEXT = "（当前没有此类上下文。）";
const SNAPSHOT_WRAPPER_PATTERN =
  /^<prompt-snapshot surface="(workspace|runtime)" digest="([a-f0-9]{64})">\n\[(工作区上下文|运行时上下文)完整快照\] 本快照替代此前同 surface 的所有快照。\n\n([\s\S]*)\n<\/prompt-snapshot>$/;

function joinSections(sections: PromptSection[]): string {
  return sections.map((section) => section.text).join("\n\n");
}

function snapshotBody(text: string): string {
  return text || EMPTY_SNAPSHOT_TEXT;
}

function snapshotDigest(surface: PromptSnapshot["surface"], text: string): string {
  return createHash("sha256")
    .update(`${surface}\0${snapshotBody(text)}`)
    .digest("hex");
}

export class PromptBuilder {
  private readonly pipes: PromptPipe[] = [];

  pipe(pipe: PromptPipe): this {
    if (this.pipes.some((candidate) => candidate.name === pipe.name)) {
      throw new Error(`Prompt pipe ${pipe.name} is already registered`);
    }
    this.pipes.push(pipe);
    return this;
  }

  assemble(context: PromptContext): PromptAssembly {
    const sections: PromptSection[] = [];
    for (const pipe of this.pipes) {
      if (pipe.requiresTools?.some((toolName) => !context.toolNames.has(toolName))) continue;
      const text = pipe.render(context);
      if (text?.trim()) sections.push({ name: pipe.name, surface: pipe.surface, text });
    }
    const system = joinSections(sections.filter((section) => section.surface === "system"));
    const snapshots = (["workspace", "runtime"] as const).map((surface) => {
      const text = joinSections(sections.filter((section) => section.surface === surface));
      return { surface, text, digest: snapshotDigest(surface, text) };
    });
    return { system, snapshots, sections };
  }
}

export class PromptSnapshotState {
  private readonly digests = new Map<PromptSnapshot["surface"], string>();

  restore(messages: readonly ModelMessage[]): void {
    this.digests.clear();
    for (const message of messages) {
      if (message.role !== "user" || typeof message.content !== "string") continue;
      const match = message.content.match(SNAPSHOT_WRAPPER_PATTERN);
      if (!match) continue;
      const surface = match[1] as PromptSnapshot["surface"];
      const digest = match[2];
      const label = match[3];
      const body = match[4];
      const expectedLabel = surface === "workspace" ? "工作区上下文" : "运行时上下文";
      if (
        label !== expectedLabel ||
        digest === undefined ||
        body === undefined ||
        snapshotDigest(surface, body) !== digest
      ) {
        continue;
      }
      this.digests.set(surface, digest);
    }
  }

  selectUpdates(snapshots: readonly PromptSnapshot[]): PromptSnapshot[] {
    const updates: PromptSnapshot[] = [];
    for (const snapshot of snapshots) {
      const previous = this.digests.get(snapshot.surface);
      this.digests.set(snapshot.surface, snapshot.digest);
      if (previous === snapshot.digest) continue;
      if (previous === undefined && !snapshot.text) continue;
      updates.push(snapshot);
    }
    return updates;
  }
}

export function renderPromptSnapshot(snapshot: PromptSnapshot): ModelMessage {
  const label = snapshot.surface === "workspace" ? "工作区上下文" : "运行时上下文";
  return {
    role: "user",
    content: `<prompt-snapshot surface="${snapshot.surface}" digest="${snapshot.digest}">\n[${label}完整快照] 本快照替代此前同 surface 的所有快照。\n\n${snapshotBody(snapshot.text)}\n</prompt-snapshot>`,
  };
}

export function coreRules(): PromptPipe {
  return {
    name: "coreRules",
    surface: "system",
    render: () =>
      "You are a Kernifold managed agent. Follow the product-provided instructions and server-owned execution policy. Use available tools only when needed, then answer directly.",
  };
}

export function toolGuide(): PromptPipe {
  return {
    name: "toolGuide",
    surface: "system",
    render: (context) =>
      context.toolNames.size > 0 ? `你有 ${context.toolNames.size} 个已授权工具可用。` : null,
  };
}

export function deferredTools(): PromptPipe {
  return {
    name: "deferredTools",
    surface: "runtime",
    requiresTools: ["tool_search"],
    render: (context) =>
      context.deferredToolSummary
        ? `如果需要的工具不在当前列表中，使用 tool_search 搜索。${context.deferredToolSummary}`
        : null,
  };
}

export function sessionContext(): PromptPipe {
  return {
    name: "sessionContext",
    surface: "system",
    render: (context) =>
      context.sessionMessageCount > 0
        ? `[会话信息] 当前会话 ${context.sessionId}，已有 ${context.sessionMessageCount} 条历史消息。`
        : null,
  };
}
