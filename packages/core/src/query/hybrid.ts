import type { SearchResult } from './types.js';

export interface HybridWeights {
  fulltext: number;
  semantic: number;
  graph: number;
}

/**
 * Weighted fusion of search result lists.
 */
export function hybridSearch(
  results: {
    fulltext: SearchResult[];
    semantic: SearchResult[];
    graph: SearchResult[];
  },
  weights: HybridWeights = { fulltext: 1.0, semantic: 0.7, graph: 0.5 },
): SearchResult[] {
  const map = new Map<string, SearchResult>();

  const merge = (
    list: SearchResult[],
    channel: 'fulltext' | 'semantic' | 'graph',
    weight: number,
  ) => {
    for (const r of list) {
      const existing = map.get(r.asset.id);
      if (!existing) {
        map.set(r.asset.id, {
          ...r,
          score: r.score * weight,
          matchedBy: [channel],
        });
      } else {
        existing.score += r.score * weight;
        if (!existing.matchedBy.includes(channel)) {
          existing.matchedBy.push(channel);
        }
      }
    }
  };

  merge(results.fulltext, 'fulltext', weights.fulltext);
  merge(results.semantic, 'semantic', weights.semantic);
  merge(results.graph, 'graph', weights.graph);

  return [...map.values()].sort((a, b) => b.score - a.score);
}
