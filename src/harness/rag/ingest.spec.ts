import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chunkDocument } from "./chunker.js";
import { DIMS, type EmbeddingFn } from "./embedder.js";
import { importDocuments, ingestDocument } from "./ingest.js";
import { SqliteVectorStore } from "./sqlite-store.js";

const tempDirectories: string[] = [];
const unavailableVectorExtension = {
  loadVectorExtension: () => {
    throw new Error("sqlite-vec unavailable");
  },
};
const testEmbedder: EmbeddingFn = (texts) =>
  Promise.resolve(texts.map(() => Array<number>(DIMS).fill(0)));

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RAG document ingestion", () => {
  it("skips unchanged content and replaces every old source chunk", async () => {
    const source = join(makeTempDirectory(), "document.md");
    const store = new SqliteVectorStore(":memory:", unavailableVectorExtension);
    try {
      fs.writeFileSync(source, `${"first sentence. ".repeat(100)}\n\nobsolete tail`);
      const first = await ingestDocument(source, store, testEmbedder);
      expect(first.status).toBe("imported");
      expect(first.chunks).toBeGreaterThan(1);

      await expect(ingestDocument(source, store, testEmbedder)).resolves.toMatchObject({
        status: "skipped",
      });

      fs.writeFileSync(source, "replacement only");
      await expect(ingestDocument(source, store, testEmbedder)).resolves.toMatchObject({
        status: "imported",
      });
      expect(store.countSource(source)).toBe(1);
      expect(store.keywordSearch("obsolete", 10)).toHaveLength(0);
      expect(store.keywordSearch("replacement", 10).map(({ chunk }) => chunk.id)).toEqual([
        `${source}#0`,
      ]);
    } finally {
      store.close();
    }
  });

  it("continues after one document fails", async () => {
    const directory = makeTempDirectory();
    const valid = join(directory, "valid.md");
    const missing = join(directory, "missing.md");
    const store = new SqliteVectorStore(":memory:", unavailableVectorExtension);
    fs.writeFileSync(valid, "valid document");
    try {
      const summary = await importDocuments([missing, valid], store, testEmbedder);
      expect(summary.failed).toHaveLength(1);
      expect(summary.imported).toHaveLength(1);
      expect(store.countSource(valid)).toBe(1);
    } finally {
      store.close();
    }
  });

  it("rolls back source replacement when a vector write fails", () => {
    const store = new SqliteVectorStore(":memory:");
    const original = chunkDocument("docs/atomic.md", "original content")[0];
    const replacement = chunkDocument("docs/atomic.md", "replacement content")[0];
    if (!original || !replacement) throw new Error("Missing test chunks");
    try {
      store.replaceSource(
        original.source,
        [{ chunk: original, embedding: Array<number>(DIMS).fill(0) }],
        "original-hash",
      );
      expect(() =>
        store.replaceSource(
          replacement.source,
          [{ chunk: replacement, embedding: [1] }],
          "replacement-hash",
        ),
      ).toThrow();
      expect(store.documentHash(original.source)).toBe("original-hash");
      expect(store.keywordSearch("original", 5)).toHaveLength(1);
      expect(store.keywordSearch("replacement", 5)).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("handles FTS special characters without throwing", () => {
    const store = new SqliteVectorStore(":memory:", unavailableVectorExtension);
    const chunk = chunkDocument("docs/language.md", "C++ hello-world quoted text")[0];
    if (!chunk) throw new Error("Missing test chunk");
    try {
      store.replaceSource(
        chunk.source,
        [{ chunk, embedding: Array<number>(DIMS).fill(0) }],
        "hash",
      );
      for (const query of ["C++", "hello-world", 'unclosed"', "+++"]) {
        expect(() => store.keywordSearch(query, 5)).not.toThrow();
      }
    } finally {
      store.close();
    }
  });

  it("hard-splits text without sentence boundaries", () => {
    const chunks = chunkDocument("docs/long.md", "x".repeat(3000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 1024)).toBe(true);
  });
});

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "kernifold-rag-ingest-"));
  tempDirectories.push(directory);
  return directory;
}
