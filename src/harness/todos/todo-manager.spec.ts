import { describe, expect, it } from "vitest";
import { TodoManager } from "./todo-manager.js";

describe("TodoManager", () => {
  it("preserves the create, replace, update, and formatting behavior", () => {
    const todos = new TodoManager();

    expect(todos.create(["Read current tools", "Add planning tools"])).toEqual([
      { id: "1", description: "Read current tools", status: "pending" },
      { id: "2", description: "Add planning tools", status: "pending" },
    ]);
    expect(todos.updateStatus("1", "running")).toEqual({
      id: "1",
      description: "Read current tools",
      status: "running",
    });
    expect(todos.formatForPrompt()).toBe(
      "[running] #1 Read current tools\n[pending] #2 Add planning tools",
    );

    expect(todos.create(["Verify tests"])).toEqual([
      { id: "1", description: "Verify tests", status: "pending" },
    ]);
  });
});
