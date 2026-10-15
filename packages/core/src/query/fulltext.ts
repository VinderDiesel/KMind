import type { SqliteStore } from '../storage/sqlite-store.js';
import type { SearchQuery, SearchResult } from './types.js';

/**
 * FTS5 fulltext search.
 */
export async function fulltextSearch(
  store: SqliteStore,
  q: SearchQuery,
): Promise<SearchResult[]> {
  const assets = await store.queryAssets({
    query: q.query,
    type: q.type,
    project: q.project,
    status: q.status,
    tags: q.tags,
    limit: q.limit ?? 10,
    minConfidence: q.minConfidence,
  });
  return assets.map((asset, i) => ({
    asset,
    score: 1 / (i + 1),
    matchedBy: ['fulltext'] as const,
    highlights: [asset.title],
  }));
}
