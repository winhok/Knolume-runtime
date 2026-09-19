import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./store.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "kernifold-memory-"));
  tempDirectories.push(directory);
  return directory;
}

describe("MemoryStore", () => {
  it("updates the same logical memory without creating a duplicate", () => {
    const store = new MemoryStore(makeTempDirectory());
    const first = store.save({
      name: "A+B",
      description: "first",
      type: "project",
      content: "version one",
    });
    const second = store.save({
      name: "A+B",
      description: "second",
      type: "project",
      content: "version two",
    });

    expect(second).toBe(first);
    expect(store.list()).toHaveLength(1);
    expect(store.loadFile(first)).toContain("version two");
  });

  it("keeps different names that normalize to the same slug", () => {
    const store = new MemoryStore(makeTempDirectory());
    const plus = store.save({
      name: "A+B",
      description: "plus",
      type: "project",
      content: "plus content",
    });
    const space = store.save({
      name: "A B",
      description: "space",
      type: "project",
      content: "space content",
    });

    expect(space).not.toBe(plus);
    expect(store.list()).toHaveLength(2);
    expect(store.loadFile(plus)).toContain("plus content");
    expect(store.loadFile(space)).toContain("space content");
  });

  it("creates distinct identities across memory types and names without a slug", () => {
    const store = new MemoryStore(makeTempDirectory());
    const userFile = store.save({
      name: "✨",
      description: "user",
      type: "user",
      content: "user content",
    });
    const projectFile = store.save({
      name: "✨",
      description: "project",
      type: "project",
      content: "project content",
    });

    expect(userFile).toMatch(/^user_memory-[a-f0-9]{12}\.md$/);
    expect(projectFile).toMatch(/^project_memory-[a-f0-9]{12}\.md$/);
    expect(projectFile).not.toBe(userFile);
    expect(store.list()).toHaveLength(2);
  });

  it("blocks traversal, absolute paths, the index, and escaping symlinks", () => {
    const directory = makeTempDirectory();
    const store = new MemoryStore(directory);
    store.init();
    const outsideFile = join(directory, "outside.md");
    writeFileSync(outsideFile, "outside", "utf8");

    expect(() => store.loadFile("../outside.md")).toThrow("非法记忆文件名");
    expect(() => store.delete(outsideFile)).toThrow("非法记忆文件名");
    expect(() => store.loadFile("MEMORY.md")).toThrow("非法记忆文件名");

    const linkName = "project_link.md";
    symlinkSync(outsideFile, join(directory, ".memory", linkName));
    expect(() => store.loadFile(linkName)).toThrow("目录之外");
    expect(store.list()).toHaveLength(0);
    expect(existsSync(outsideFile)).toBe(true);
  });

  it("ranks search results with BM25 and honors topK", () => {
    const store = new MemoryStore(makeTempDirectory());
    store.save({
      name: "authentication decision",
      description: "JWT authentication entrypoint",
      type: "project",
      content: "Authentication lives in src/auth/index.ts.",
    });
    store.save({
      name: "database preference",
      description: "Preferred local database",
      type: "user",
      content: "Use PostgreSQL for local development.",
    });

    const results = store.search("authentication", 1);

    expect(results).toHaveLength(1);
    expect(results[0]?.entry.name).toBe("authentication decision");
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it("records write/read timestamps and refreshes lastReadAt on read", () => {
    const directory = makeTempDirectory();
    const store = new MemoryStore(directory);
    const filename = store.save({
      name: "timestamp test",
      description: "timestamp test",
      type: "project",
      content: "Remember this decision.",
    });
    const filePath = join(directory, ".memory", filename);
    const beforeRead = readFileSync(filePath, "utf8");
    const firstReadAt = Number(beforeRead.match(/^lastReadAt: (\d+)$/m)?.[1]);
    const oldReadAt = firstReadAt - 10_000;
    writeFileSync(
      filePath,
      beforeRead.replace(/^lastReadAt:.*$/m, `lastReadAt: ${oldReadAt}`),
      "utf8",
    );

    store.loadFile(filename);

    const afterRead = readFileSync(filePath, "utf8");
    const refreshedReadAt = Number(afterRead.match(/^lastReadAt: (\d+)$/m)?.[1]);
    expect(afterRead).toMatch(/^lastWriteAt: \d+$/m);
    expect(refreshedReadAt).toBeGreaterThan(oldReadAt);
  });
});
