import { KnowledgeAssetIdPattern, type KnowledgeAsset } from '@kmind/shared';
import type { Vault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { appendSearchQueryLog } from '../observability/search-query-log.js';
import { fulltextSearch } from './fulltext.js';
import { semanticSearch } from './semantic.js';
import { graphNeighborhoodSearch, graphQuery } from './graph.js';
import { hybridSearch } from './hybrid.js';
import type { QueryEngine, SearchQuery, SearchResult } from './types.js';
import { getProblemStatus } from './problem-status.js';
import { assessProjectCoverage } from './coverage.js';
import { buildContextPack } from './context-pack.js';

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
      const started = Date.now();
      const limit = q.limit ?? 10;
      const trimmed = q.query?.trim() ?? '';
      let results: SearchResult[] = [];
      try {
        // Exact id lookup — never drown a known asset under session noise.
        if (KnowledgeAssetIdPattern.test(trimmed)) {
          const exact = await store.getAsset(trimmed);
          if (exact) {
            results = [
              {
                asset: exact,
                score: 1,
                matchedBy: ['id'],
              },
            ];
            return results;
          }
        }
        const [fulltext, semantic] = await Promise.all([
          fulltextSearch(store, { ...q, limit }),
          semanticSearch(store, { ...q, limit }),
        ]);
        const seedIds = fulltext.slice(0, 3).map((r) => r.asset.id);
        const graph = await graphNeighborhoodSearch(store, seedIds, 1);
        results = hybridSearch({ fulltext, semantic, graph })
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
        return results;
      } finally {
        await appendSearchQueryLog(vault.auditDir, {
          kind: 'search',
          query: trimmed,
          project: q.project,
          type: q.type,
          limit,
          resultCount: results.length,
          topHits: results.slice(0, 5).map((r) => ({
            id: r.asset.id,
            score: r.score,
            matchedBy: r.matchedBy,
            title: r.asset.title,
          })),
          empty: results.length === 0,
          latencyMs: Date.now() - started,
          source: q.source ?? 'engine',
        });
      }
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

    async pack(opts) {
      const started = Date.now();
      const pack = await buildContextPack(store, opts);
      const queryEcho = (opts.query ?? opts.id ?? pack.query ?? '').trim();
      const topHits = [
        ...(pack.focus
          ? [{ id: pack.focus.id, score: 1, title: pack.focus.title }]
          : []),
        ...pack.alternatives.slice(0, 4).map((a) => ({
          id: a.id,
          score: a.score,
          matchedBy: a.matchedBy,
          title: a.title,
        })),
      ];
      await appendSearchQueryLog(vault.auditDir, {
        kind: 'pack',
        query: queryEcho,
        project: opts.project,
        type: opts.type,
        resultCount: (pack.focus ? 1 : 0) + pack.alternatives.length,
        topHits,
        empty: !pack.focus,
        latencyMs: Date.now() - started,
        source: opts.source ?? 'engine',
        focusId: pack.focus?.id ?? null,
      });
      return pack;
    },
  };
}

export type { QueryEngine, SearchQuery, SearchResult };
