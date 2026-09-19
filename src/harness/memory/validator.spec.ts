import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "./store.js";
import { prepareMemoryLint } from "./validator.js";

describe("prepareMemoryLint", () => {
  it("separates portable Workspace checks without returning absolute host paths", () => {
    const entry: MemoryEntry = {
      filePath: "/private/memory/project.md",
      name: "project",
      description: "desc",
      type: "project",
      content:
        "Use src/main.ts and ./docs/spec.md, not /Users/name/secret.ts, ../escape.ts or C:\\Users\\name\\win.ts",
    };

    const [prepared] = prepareMemoryLint([entry]);

    expect(prepared?.relativePaths).toEqual(["src/main.ts", "docs/spec.md"]);
    expect(prepared?.nonPortablePathCount).toBe(3);
    expect(JSON.stringify(prepared?.relativePaths)).not.toContain("Users");
  });
});
