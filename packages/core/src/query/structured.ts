import type { SqliteStore } from '../storage/sqlite-store.js';
import type { SearchQuery, SearchResult } from './types.js';

/**
 * Structured metadata filter search (no free-text).
 */
export async function structuredSearch(
  store: SqliteStore,
  q: Omit<SearchQuery, 'query'> & { query?: string },
): Promise<SearchResult[]> {
  const assets = await store.queryAssets({
    type: q.type,
    project: q.project,
    status: q.status,
    tags: q.tags,
    limit: q.limit ?? 10,
    minConfidence: q.minConfidence,
  });
  return assets.map((asset) => ({
    asset,
    score: asset.confidence,
    matchedBy: ['structured'] as const,
  }));
}
