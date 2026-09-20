import { describe, expect, it } from "vitest";
import { mmrSelect, type SearchResult } from "./search.js";

function result(id: string, text: string, score: number): SearchResult {
  return {
    chunk: {
      id,
      text,
      source: id,
      index: 0,
      tokenEstimate: 2,
      embedding: [],
      addedAt: 0,
    },
    score,
    vectorScore: score,
    keywordScore: 0,
  };
}

describe("MMR retrieval diversity", () => {
  it("prefers a relevant distinct document over duplicate content without mutating input", () => {
    const items = [
      result("a", "runtime agent", 1),
      result("duplicate", "runtime agent", 0.99),
      result("b", "sqlite persistence", 0.9),
    ];
    expect(mmrSelect(items, 2).map((x) => x.chunk.id)).toEqual(["a", "b"]);
    expect(items.map((x) => x.chunk.id)).toEqual(["a", "duplicate", "b"]);
  });
  it("handles empty inputs, zero limits and fewer results than requested", () => {
    const items = [
      result("a", "", 1),
      result("b", "!", 0.8),
      result("c", "?", 0.7),
    ];
    expect(mmrSelect([], 3)).toEqual([]);
    expect(mmrSelect(items, 0)).toEqual([]);
    expect(mmrSelect(items, 5)).toEqual(items);
    expect(mmrSelect(items, 2).map((x) => x.chunk.id)).toEqual(["a", "b"]);
  });
});
