import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatProjectRules, loadProjectRules } from "./project-rules.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeTempDirectory(prefix = "kernifold-rules-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

describe("project rules", () => {
  it("loads scoped rules from the workspace root to the target directory", async () => {
    const workspace = await makeTempDirectory();
    const target = join(workspace, "packages", "app");
    await mkdir(target, { recursive: true });
    await writeFile(join(workspace, "AGENTS.md"), "root rule");
    await writeFile(join(workspace, ".agents.md"), "ignored fallback");
    await writeFile(join(workspace, "packages", ".agents.md"), "package rule");

    const rules = await loadProjectRules(workspace, target);

    expect(rules.map((rule) => rule.relativePath)).toEqual(["AGENTS.md", "packages/.agents.md"]);
    expect(formatProjectRules(rules)).toContain("root rule");
    expect(formatProjectRules(rules)).toContain("package rule");
  });

  it("rejects a target outside the workspace", async () => {
    const workspace = await makeTempDirectory();

    await expect(loadProjectRules(workspace, tmpdir())).rejects.toThrow("工作区之外");
  });

  it("does not hide rule read failures", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;

    const workspace = await makeTempDirectory();
    const rulePath = join(workspace, "AGENTS.md");
    await writeFile(rulePath, "private");
    await chmod(rulePath, 0o000);

    try {
      await expect(loadProjectRules(workspace)).rejects.toThrow("AGENTS.md");
    } finally {
      await chmod(rulePath, 0o600);
    }
  });

  it("rejects rule files that are symlinked outside the workspace", async () => {
    const workspace = await makeTempDirectory();
    const outside = await makeTempDirectory("kernifold-rules-outside-");
    await writeFile(join(outside, "rules.md"), "injected rule");
    await symlink(join(outside, "rules.md"), join(workspace, "AGENTS.md"));

    await expect(loadProjectRules(workspace)).rejects.toThrow("工作区之外");
  });
});
