import type { ToolDefinition, ToolExecutionContext } from "./registry.js";

export type PermissionLevel = "allow" | "ask" | "deny";

export interface PermissionDecision {
  level: PermissionLevel;
  reason: string;
}

export interface ApprovalRequest {
  tool: string;
  input: Record<string, unknown>;
  reason: string;
}

export type RequestApproval = (
  request: ApprovalRequest,
  abortSignal?: AbortSignal,
) => Promise<boolean>;

export type ToolPermissionPolicy = (
  tool: ToolDefinition,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
) => PermissionDecision;

export function decideToolPermission(
  tool: ToolDefinition,
  _input: Record<string, unknown>,
): PermissionDecision {
  if (
    tool.capabilities.every(
      (capability) => capability === "read" || capability === "state" || capability === "delegate",
    )
  ) {
    return { level: "allow", reason: "只读、Run 内部状态或服务端受控委派自动放行" };
  }
  if (
    tool.capabilities.includes("write") ||
    tool.capabilities.includes("execute") ||
    tool.capabilities.includes("external")
  ) {
    return { level: "ask", reason: "工具会修改状态，需要用户确认" };
  }
  return { level: "ask", reason: "工具风险未知，需要用户确认" };
}
