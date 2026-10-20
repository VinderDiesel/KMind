import type { KnowledgeAsset } from '@kmind/shared';
import type { Vault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { fulltextSearch } from './fulltext.js';
import { semanticSearch } from './semantic.js';
import { graphNeighborhoodSearch, graphQuery } from './graph.js';
import { hybridSearch } from './hybrid.js';
import type { QueryEngine, SearchQuery, SearchResult } from './types.js';
import { getProblemStatus } from './problem-status.js';
import { assessProjectCoverage } from './coverage.js';

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
      const trimmed = q.query?.trim() ?? '';
      // Exact id lookup — never drown a known asset under session noise.
      if (/^k-\d{4}-\d{2}-\d{2}-\d{3}$/.test(trimmed)) {
        const exact = await store.getAsset(trimmed);
        if (exact) {
          return [
            {
              asset: exact,
              score: 1,
              matchedBy: ['id'],
            },
          ];
        }
      }
      const [fulltext, semantic] = await Promise.all([
        fulltextSearch(store, { ...q, limit }),
        semanticSearch(store, { ...q, limit }),
      ]);
      const seedIds = fulltext.slice(0, 3).map((r) => r.asset.id);
      const graph = await graphNeighborhoodSearch(store, seedIds, 1);
      return hybridSearch({ fulltext, semantic, graph })
        .map((r) => {
          // Prefer curated manual captures over session dumps.
          if (r.asset.source.terminal === 'manual') {
            return { ...r, score: r.score * 1.35 };
          }
          if (r.asset.source.rawPath.startsWith('sessions/')) {
            return { ...r, score: r.score * 0.55 };
          }
          return r;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
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

    async problemStatus(problemId: string): Promise<unknown> {
      return getProblemStatus(store, problemId);
    },

    async coverage(opts: {
      project: string;
      topic?: string;
      hubId?: string;
    }): Promise<unknown> {
      const assets = await store.queryAssets({
        project: opts.project,
        limit: 100_000,
      });
      return assessProjectCoverage(assets, opts);
    },
  };
}

export type { QueryEngine, SearchQuery, SearchResult };
