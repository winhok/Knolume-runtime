import { Ajv, type ValidateFunction } from "ajv";
import type { ToolHookPipeline } from "./hooks.js";
import { decideToolPermission, type RequestApproval, type ToolPermissionPolicy } from "./permissions.js";
import type { ExecutableTool, ToolExecutionContext } from "./registry.js";

export const DEFAULT_MAX_RESULT_CHARS = 3000;
const MAX_AUDIT_ENTRIES = 1000;
const MAX_AUDIT_STRING_CHARS = 1000;
const SENSITIVE_AUDIT_KEY = /(?:authorization|cookie|password|secret|token|api[_-]?key)/i;

export class InvalidToolInputError extends Error {
  constructor(
    readonly toolName: string,
    readonly issues: unknown,
  ) {
    super(`Arguments for ${toolName} do not match its schema`);
  }
}

export type ToolExecutionOutcome =
  "completed" | "blocked" | "invalid" | "denied" | "aborted" | "failed";

export interface ToolExecutionAuditEntry {
  timestamp: number;
  durationMs: number;
  tool: string;
  input: unknown;
  outcome: ToolExecutionOutcome;
  reason?: string;
  permission?: {
    level: "allow" | "ask" | "deny";
    approval: "not_required" | "approved" | "rejected" | "unavailable" | "cancelled";
  };
}

export interface ToolPipelineExecutionOptions {
  /** Enforce server-owned permission and approval policy after pre hooks. */
  enforcePermissions?: boolean;
  requestApproval?: RequestApproval;
  /** Host-owned policy evaluated after hooks and input validation. */
  permissionPolicy?: ToolPermissionPolicy;
}

export class ToolExecutionPipeline {
  private readonly ajv = new Ajv({ allErrors: true, strict: false });
  private readonly validators = new WeakMap<ExecutableTool, ValidateFunction>();
  private readonly auditLog: ToolExecutionAuditEntry[] = [];
  private exclusiveLock = false;
  private concurrentCount = 0;
  private readonly waitQueue: Array<() => void> = [];

  constructor(private readonly hooks?: ToolHookPipeline) {}

  getAuditLog(): readonly ToolExecutionAuditEntry[] {
    return this.auditLog.map((entry) => structuredClone(entry));
  }

  async execute(
    tool: ExecutableTool,
    originalInput: unknown,
    context: ToolExecutionContext,
    options: ToolPipelineExecutionOptions = {},
  ): Promise<string> {
    const startedAt = Date.now();
    let input = originalInput;
    context.abortSignal?.throwIfAborted();

    if (this.hooks) {
      const preResult = await this.hooks.runPre(tool.name, input);
      context.abortSignal?.throwIfAborted();
      if (preResult.action === "block") {
        const reason = preResult.reason ?? "操作被阻止";
        this.recordAudit(tool.name, input, "blocked", startedAt, reason);
        return `[Hook 拦截] ${reason}`;
      }
      if (preResult.action === "modify" && preResult.modifiedInput !== undefined) {
        input = preResult.modifiedInput;
      }
    }

    let validatedInput: Record<string, unknown>;
    try {
      validatedInput = this.validateInput(tool, input);
    } catch (error) {
      this.recordAudit(tool.name, input, "invalid", startedAt, errorMessage(error));
      throw error;
    }

    let permission: ToolExecutionAuditEntry["permission"];
    if (options.enforcePermissions) {
      const decision = (options.permissionPolicy ?? decideToolPermission)(tool, validatedInput, context);
      let approval: NonNullable<ToolExecutionAuditEntry["permission"]>["approval"] = "not_required";
      if (decision.level === "deny") {
        permission = { level: decision.level, approval };
        this.recordAudit(
          tool.name,
          validatedInput,
          "denied",
          startedAt,
          decision.reason,
          permission,
        );
        return `[拒绝执行] ${decision.reason}: ${tool.name}`;
      }
      if (decision.level === "ask") {
        if (!options.requestApproval) {
          const reason = `${decision.reason}，但当前运行环境没有审批通道`;
          permission = { level: decision.level, approval: "unavailable" };
          this.recordAudit(tool.name, validatedInput, "denied", startedAt, reason, permission);
          return `[拒绝执行] ${reason}: ${tool.name}`;
        }
        let approved: boolean;
        try {
          approved = await options.requestApproval(
            { tool: tool.name, input: validatedInput, reason: decision.reason },
            context.abortSignal,
          );
        } catch (error) {
          if (context.abortSignal?.aborted || isAbortError(error)) {
            permission = { level: decision.level, approval: "cancelled" };
            this.recordAudit(
              tool.name,
              validatedInput,
              "aborted",
              startedAt,
              errorMessage(error),
              permission,
            );
            throw error;
          }
          const reason = `${decision.reason}，审批失败: ${errorMessage(error)}`;
          permission = { level: decision.level, approval: "unavailable" };
          this.recordAudit(tool.name, validatedInput, "denied", startedAt, reason, permission);
          return `[拒绝执行] ${reason}: ${tool.name}`;
        }
        context.abortSignal?.throwIfAborted();
        approval = approved ? "approved" : "rejected";
        if (!approved) {
          const reason = `用户拒绝: ${decision.reason}`;
          permission = { level: decision.level, approval };
          this.recordAudit(tool.name, validatedInput, "denied", startedAt, reason, permission);
          return `[拒绝执行] ${reason}: ${tool.name}`;
        }
      }
      permission = { level: decision.level, approval };
    }

    const useLock = tool.holdsExecutionLock !== false;
    if (useLock) {
      if (tool.isConcurrencySafe === true) await this.acquireConcurrent(context.abortSignal);
      else await this.acquireExclusive(context.abortSignal);
    }

    try {
      context.abortSignal?.throwIfAborted();
      const raw = await tool.execute(validatedInput, context);
      const text = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
      let output = truncateResult(text, tool.maxResultChars);
      if (this.hooks) {
        const postResult = await this.hooks.runPost(tool.name, validatedInput, output);
        context.abortSignal?.throwIfAborted();
        if (postResult.action === "block") {
          const reason = postResult.reason ?? "工具输出被阻止";
          this.recordAudit(tool.name, validatedInput, "blocked", startedAt, reason, permission);
          return `[Hook 拦截] ${reason}`;
        }
        if (postResult.modifiedOutput !== undefined) {
          output =
            typeof postResult.modifiedOutput === "string"
              ? postResult.modifiedOutput
              : JSON.stringify(postResult.modifiedOutput, null, 2);
        }
      }
      this.recordAudit(tool.name, validatedInput, "completed", startedAt, undefined, permission);
      return output;
    } catch (error) {
      this.recordAudit(
        tool.name,
        validatedInput,
        context.abortSignal?.aborted || isAbortError(error) ? "aborted" : "failed",
        startedAt,
        errorMessage(error),
        permission,
      );
      throw error;
    } finally {
      if (useLock) {
        if (tool.isConcurrencySafe === true) this.releaseConcurrent();
        else this.releaseExclusive();
      }
    }
  }

  private validateInput(tool: ExecutableTool, input: unknown): Record<string, unknown> {
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) throw new InvalidToolInputError(tool.name, parsed.error.issues);
    if (tool.inputJsonSchema) {
      let validate = this.validators.get(tool);
      if (!validate) {
        const compiled = this.ajv.compile(tool.inputJsonSchema);
        this.validators.set(tool, compiled);
        validate = compiled;
      }
      if (!validate(parsed.data)) throw new InvalidToolInputError(tool.name, validate.errors);
    }
    return parsed.data;
  }

  private recordAudit(
    tool: string,
    input: unknown,
    outcome: ToolExecutionOutcome,
    startedAt: number,
    reason?: string,
    permission?: ToolExecutionAuditEntry["permission"],
  ): void {
    const entry: ToolExecutionAuditEntry = {
      timestamp: startedAt,
      durationMs: Date.now() - startedAt,
      tool,
      input: sanitizeAuditValue(input),
      outcome,
      ...(reason === undefined ? {} : { reason: clipString(reason) }),
      ...(permission === undefined ? {} : { permission }),
    };
    this.auditLog.push(entry);
    if (this.auditLog.length > MAX_AUDIT_ENTRIES) this.auditLog.shift();
  }

  private async acquireConcurrent(signal?: AbortSignal): Promise<void> {
    while (this.exclusiveLock) {
      await this.waitForUnlock(signal);
    }
    signal?.throwIfAborted();
    this.concurrentCount += 1;
  }

  private releaseConcurrent(): void {
    this.concurrentCount -= 1;
    if (this.concurrentCount === 0) this.drainQueue();
  }

  private async acquireExclusive(signal?: AbortSignal): Promise<void> {
    while (this.exclusiveLock || this.concurrentCount > 0) {
      await this.waitForUnlock(signal);
    }
    signal?.throwIfAborted();
    this.exclusiveLock = true;
  }

  private releaseExclusive(): void {
    this.exclusiveLock = false;
    this.drainQueue();
  }

  private drainQueue(): void {
    const waiting = this.waitQueue.splice(0);
    for (const resolve of waiting) resolve();
  }

  private waitForUnlock(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      let waiting = true;
      const wake = (): void => {
        if (!waiting) return;
        waiting = false;
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = (): void => {
        if (!waiting) return;
        waiting = false;
        const index = this.waitQueue.indexOf(wake);
        if (index >= 0) this.waitQueue.splice(index, 1);
        const reason = signal === undefined ? undefined : (signal.reason as unknown);
        if (reason instanceof Error) reject(reason);
        else {
          const error = new Error("The operation was aborted", { cause: reason });
          error.name = "AbortError";
          reject(error);
        }
      };
      this.waitQueue.push(wake);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

export function sanitizeAuditValue(value: unknown, key = ""): unknown {
  return sanitizeAuditNode(value, key, 0, new WeakSet<object>());
}

function sanitizeAuditNode(
  value: unknown,
  key: string,
  depth: number,
  ancestors: WeakSet<object>,
): unknown {
  if (SENSITIVE_AUDIT_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return clipString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 5) return "[MAX_DEPTH]";
  if (ancestors.has(value)) return "[CIRCULAR]";

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((item) => sanitizeAuditNode(item, "", depth + 1, ancestors));
    }
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([childKey, child]) => [
          childKey,
          sanitizeAuditNode(child, childKey, depth + 1, ancestors),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

export function truncateResult(text: string, maxChars: number = DEFAULT_MAX_RESULT_CHARS): string {
  if (text.length <= maxChars) return text;
  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = maxChars - headSize;
  const dropped = text.length - maxChars;
  return `${text.slice(0, headSize)}\n\n... [省略 ${dropped} 字符] ...\n\n${text.slice(-tailSize)}`;
}

function clipString(value: string): string {
  return value.length <= MAX_AUDIT_STRING_CHARS
    ? value
    : `${value.slice(0, MAX_AUDIT_STRING_CHARS)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
