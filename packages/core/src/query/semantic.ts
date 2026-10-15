import type { SqliteStore } from '../storage/sqlite-store.js';
import { hashEmbed } from '../compiler/embedder.js';
import type { SearchQuery, SearchResult } from './types.js';

/**
 * Semantic search with metadata pre-filter then cosine similarity (brute force <10k).
 */
export async function semanticSearch(
  store: SqliteStore,
  q: SearchQuery,
  dimension = 384,
): Promise<SearchResult[]> {
  const queryVec = hashEmbed(q.query, dimension);
  const vectors = await store.getVectors({
    project: q.project,
    type: q.type,
    status: q.status,
  });

  const scored = vectors
    .map((v) => ({
      id: v.id,
      score: cosine(queryVec, v.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, q.limit ?? 10);

  const results: SearchResult[] = [];
  for (const s of scored) {
    const asset = await store.getAsset(s.id);
    if (!asset) continue;
    if (q.minConfidence !== undefined && asset.confidence < q.minConfidence) continue;
    results.push({
      asset,
      score: s.score,
      matchedBy: ['semantic'],
    });
  }
  return results;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
