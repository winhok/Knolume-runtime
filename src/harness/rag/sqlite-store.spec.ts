import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DIMS } from "./embedder.js";
import { SqliteVectorStore } from "./sqlite-store.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "kernifold-rag-"));
  tempDirectories.push(directory);
  return directory;
}

function unitVector(index: number): number[] {
  const vector = Array<number>(DIMS).fill(0);
  vector[index] = 1;
  return vector;
}

const unavailableVectorExtension = {
  loadVectorExtension: () => {
    throw new Error("sqlite-vec unavailable");
  },
};

describe("SqliteVectorStore fallback", () => {
  it("keeps vector search available when sqlite-vec fails to load", () => {
    const store = new SqliteVectorStore(":memory:", unavailableVectorExtension);
    try {
      store.add(
        {
          id: "docs/a.md#0",
          text: "alpha",
          source: "docs/a.md",
          index: 0,
          tokenEstimate: 1,
        },
        unitVector(0),
      );
      store.add(
        {
          id: "docs/b.md#0",
          text: "beta",
          source: "docs/b.md",
          index: 0,
          tokenEstimate: 1,
        },
        unitVector(1),
      );

      expect(store.vectorSearch(unitVector(0), 1).map(({ chunk }) => chunk.id)).toEqual([
        "docs/a.md#0",
      ]);

      store.clear();
      expect(store.size()).toBe(0);
    } finally {
      store.close();
    }
  });

  it("uses persisted embeddings after the database is reopened", () => {
    const dbPath = join(makeTempDirectory(), "knowledge.db");
    const original = new SqliteVectorStore(dbPath, unavailableVectorExtension);
    original.add(
      {
        id: "docs/persisted.md#0",
        text: "persisted",
        source: "docs/persisted.md",
        index: 0,
        tokenEstimate: 2,
      },
      unitVector(2),
    );
    original.close();

    const reopened = new SqliteVectorStore(dbPath, unavailableVectorExtension);
    try {
      expect(reopened.vectorSearch(unitVector(2), 1).map(({ chunk }) => chunk.id)).toEqual([
        "docs/persisted.md#0",
      ]);
    } finally {
      reopened.close();
    }
  });

  it("returns the same top-k order with and without sqlite-vec", () => {
    const dbPath = join(makeTempDirectory(), "knowledge.db");
    const mixedVector = Array<number>(DIMS).fill(0);
    mixedVector[0] = 0.8;
    mixedVector[1] = 0.6;
    const items = [
      { id: "exact", text: "exact", embedding: unitVector(0) },
      { id: "mixed", text: "mixed", embedding: mixedVector },
      { id: "other", text: "other", embedding: unitVector(1) },
    ];

    const accelerated = new SqliteVectorStore(dbPath);
    for (const [index, item] of items.entries()) {
      accelerated.add(
        {
          id: item.id,
          text: item.text,
          source: "docs/vectors.md",
          index,
          tokenEstimate: 1,
        },
        item.embedding,
      );
    }
    const acceleratedIds = accelerated.vectorSearch(unitVector(0), 2).map(({ chunk }) => chunk.id);
    accelerated.close();

    const fallback = new SqliteVectorStore(dbPath, unavailableVectorExtension);
    try {
      const fallbackIds = fallback.vectorSearch(unitVector(0), 2).map(({ chunk }) => chunk.id);

      expect(acceleratedIds).toEqual(["exact", "mixed"]);
      expect(fallbackIds).toEqual(acceleratedIds);
    } finally {
      fallback.close();
    }
  });

  it("backfills embeddings written during fallback after sqlite-vec recovers", () => {
    const dbPath = join(makeTempDirectory(), "knowledge.db");
    const fallback = new SqliteVectorStore(dbPath, unavailableVectorExtension);
    fallback.add(
      {
        id: "recovered",
        text: "recovered",
        source: "docs/recovered.md",
        index: 0,
        tokenEstimate: 2,
      },
      unitVector(3),
    );
    fallback.close();

    const recovered = new SqliteVectorStore(dbPath);
    try {
      expect(recovered.vectorSearch(unitVector(3), 1).map(({ chunk }) => chunk.id)).toEqual([
        "recovered",
      ]);
    } finally {
      recovered.close();
    }
  });
});
