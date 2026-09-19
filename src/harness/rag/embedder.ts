const DIMS = 128;

export type EmbeddingFn = (texts: string[]) => Promise<number[][]>;

export interface OpenAICompatibleEmbedderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  dimensions?: number;
}

export function createOpenAICompatibleEmbedder(
  options: OpenAICompatibleEmbedderOptions,
): EmbeddingFn {
  return async (texts: string[]) => {
    const resp = await fetch(`${options.baseURL.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        input: texts,
        dimensions: options.dimensions ?? DIMS,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Embedding API error: ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map(({ embedding }) => embedding);
  };
}

export function createDashScopeEmbedder(apiKey: string): EmbeddingFn {
  return createOpenAICompatibleEmbedder({
    apiKey,
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "text-embedding-v3",
    dimensions: DIMS,
  });
}

const embedCache = new Map<string, number[]>();

export async function embed(fn: EmbeddingFn, texts: string[]): Promise<number[][]> {
  const results = new Array<number[]>(texts.length);
  const uncached: { idx: number; text: string }[] = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (text === undefined) continue;

    const cached = embedCache.get(text);
    if (cached) {
      results[i] = cached;
    } else {
      uncached.push({ idx: i, text });
    }
  }

  if (uncached.length > 0) {
    const vectors = await fn(uncached.map((u) => u.text));
    for (const [i, item] of uncached.entries()) {
      const vector = vectors[i];
      if (vector === undefined) {
        throw new Error(`Missing embedding at index ${i}`);
      }

      results[item.idx] = vector;
      embedCache.set(item.text, vector);
    }
  }

  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} !== ${b.length}`);
  }

  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    const aValue = a[i];
    const bValue = b[i];
    if (aValue === undefined || bValue === undefined) continue;

    dot += aValue * bValue;
    normA += aValue * aValue;
    normB += bValue * bValue;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

export { DIMS };
