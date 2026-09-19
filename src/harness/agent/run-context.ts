import { resolve } from "node:path";
import { TodoManager } from "../todos/todo-manager.js";

export interface AgentRunContext {
  workingDir: string;
  todoManager: TodoManager;
}

export function createAgentRunContext(workingDir: string): AgentRunContext {
  return { workingDir: resolve(workingDir), todoManager: new TodoManager() };
}
