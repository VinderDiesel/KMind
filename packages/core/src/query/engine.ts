import type { KnowledgeAsset } from '@kmind/shared';
import type { Vault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { fulltextSearch } from './fulltext.js';
import { semanticSearch } from './semantic.js';
import { graphNeighborhoodSearch, graphQuery } from './graph.js';
import { hybridSearch } from './hybrid.js';
import type { QueryEngine, SearchQuery, SearchResult } from './types.js';

/**
 * Create a hybrid query engine bound to a vault.
 */
export function createQueryEngine(
  vault: Vault,
  existingStore?: SqliteStore,
): QueryEngine {
  const store = existingStore ?? new SqliteStore(vault.indexPath);
  return {
    async search(q: SearchQuery): Promise<SearchResult[]> {
      const limit = q.limit ?? 10;
      const [fulltext, semantic] = await Promise.all([
        fulltextSearch(store, { ...q, limit }),
        semanticSearch(store, { ...q, limit }),
      ]);
      const seedIds = fulltext.slice(0, 3).map((r) => r.asset.id);
      const graph = await graphNeighborhoodSearch(store, seedIds, 1);
      return hybridSearch({ fulltext, semantic, graph }).slice(0, limit);
    },

    async getById(id: string): Promise<KnowledgeAsset | null> {
      return store.getAsset(id);
    },

    async related(id: string, depth = 1): Promise<KnowledgeAsset[]> {
      const ids = await store.getRelated(id, Math.min(depth, 5));
      const assets: KnowledgeAsset[] = [];
      for (const rid of ids) {
        const a = await store.getAsset(rid);
        if (a) assets.push(a);
      }
      return assets;
    },

    async graphQuery(cypherLike: string): Promise<unknown[]> {
      return graphQuery(store, cypherLike);
    },

    async status(): Promise<Record<string, unknown>> {
      return {
        vaultPath: vault.root,
        assetCount: await store.countAssets(),
        lastCompileAt: await store.getLastCompileTime(),
        compileState: await store.getCompileState(),
      };
    },
  };
}

export type { QueryEngine, SearchQuery, SearchResult };
