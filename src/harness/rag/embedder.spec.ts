import { afterEach, expect, it, vi } from "vitest";
import {
  createOpenAICompatibleEmbedder,
  createDashScopeEmbedder,
  embed,
  cosineSimilarity,
} from "./embedder.js";
afterEach(() => vi.unstubAllGlobals());
it("sends compatible embedding requests and reports HTTP failures", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] })),
    );
  vi.stubGlobal("fetch", fetcher);
  const fn = createOpenAICompatibleEmbedder({
    apiKey: "fixture",
    baseURL: "https://example.invalid/v1/",
    model: "fixture-model",
    dimensions: 2,
  });
  expect(await fn(["hello"])).toEqual([[1, 0]]);
  expect(fetcher).toHaveBeenCalledWith(
    "https://example.invalid/v1/embeddings",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        model: "fixture-model",
        input: ["hello"],
        dimensions: 2,
      }),
    }),
  );
  fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  await expect(fn(["hello"])).rejects.toThrow("503 unavailable");
  await createDashScopeEmbedder("fixture")(["hello"]);
  expect(JSON.parse(fetcher.mock.calls[2]![1].body)).toMatchObject({
    model: "text-embedding-v3",
    dimensions: 128,
  });
  await createOpenAICompatibleEmbedder({
    apiKey: "fixture",
    baseURL: "https://example.invalid",
    model: "default-dims",
  })([]);
  expect(JSON.parse(fetcher.mock.calls[3]![1].body).dimensions).toBe(128);
});
it("caches per embedder and preserves input order across cache hits", async () => {
  const a = vi.fn(async (texts: string[]) =>
    texts.map((text) => [text.length, 1]),
  );
  const b = vi.fn(async (texts: string[]) => texts.map(() => [0, 2]));
  expect(await embed(a, ["isolation", "short"])).toEqual([
    [9, 1],
    [5, 1],
  ]);
  expect(await embed(a, ["short", "isolation"])).toEqual([
    [5, 1],
    [9, 1],
  ]);
  expect(a).toHaveBeenCalledTimes(1);
  expect(await embed(b, ["isolation"])).toEqual([[0, 2]]);
  expect(await embed(a, [])).toEqual([]);
});
it("rejects incomplete provider results and allows retry", async () => {
  const fn = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[1]]);
  await expect(embed(fn, ["missing-vector-fixture"])).rejects.toThrow(
    "Missing embedding",
  );
  expect(await embed(fn, ["missing-vector-fixture"])).toEqual([[1]]);
});
it("computes cosine boundaries and rejects incompatible dimensions", () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  expect(() => cosineSimilarity([1], [1, 0])).toThrow("dimension mismatch");
});
