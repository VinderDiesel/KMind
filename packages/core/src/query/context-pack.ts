import {
  ContextPackSchema,
  CONTEXT_PACK_VERSION,
  type ContextPack,
  type KnowledgeAsset,
  type PackAssetBrief,
} from '@kmind/shared';
import { extractCodeAnchors, readCodeAnchors } from '../compiler/code-anchors.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import { buildEgoGraph } from './ego.js';
import { hybridSearch } from './hybrid.js';
import { fulltextSearch } from './fulltext.js';
import { semanticSearch } from './semantic.js';
import { graphNeighborhoodSearch } from './graph.js';
import { getProblemStatus } from './problem-status.js';
import type { SearchQuery } from './types.js';

export interface BuildContextPackOptions {
  /** Exact asset id (k-YYYY-MM-DD-NNN). Wins over query when both set. */
  id?: string;
  /** Hybrid search query when id is absent. */
  query?: string;
  project?: string;
  type?: SearchQuery['type'];
  /** Ego hop depth (default 1, max 3 for pack). */
  depth?: number;
  /** Max neighborhood nodes (default 24). */
  neighborCap?: number;
  /** Max focus/related body excerpt chars (default 1200). */
  bodyMaxChars?: number;
  /** Max alternative search hits (default 5). */
  alternativeLimit?: number;
}

const ID_RE = /^k-\d{4}-\d{2}-\d{2}-\d{3}$/;

/**
 * Build a structured Context Pack for Agents (ADR-002).
 * Deterministic assembly only — no LLM summarization.
 */
export async function buildContextPack(
  store: SqliteStore,
  options: BuildContextPackOptions,
): Promise<ContextPack> {
  const bodyMax = Math.max(200, options.bodyMaxChars ?? 1200);
  const depth = Math.min(Math.max(1, options.depth ?? 1), 3);
  const neighborCap = Math.max(4, options.neighborCap ?? 24);
  const altLimit = Math.max(0, options.alternativeLimit ?? 5);

  const hints: string[] = [];
  let focusAsset: KnowledgeAsset | null = null;
  let queryEcho: string | undefined;
  const alternatives: ContextPack['alternatives'] = [];

  const id = options.id?.trim();
  const query = options.query?.trim() ?? '';

  if (id && ID_RE.test(id)) {
    focusAsset = await store.getAsset(id);
    if (!focusAsset) {
      return ContextPackSchema.parse({
        version: CONTEXT_PACK_VERSION,
        query: query || undefined,
        focus: null,
        alternatives: [],
        neighborhood: null,
        codeAnchors: [],
        problemStatus: null,
        related: [],
        hints: [`Asset not found: ${id}`],
      });
    }
  } else if (query && ID_RE.test(query)) {
    focusAsset = await store.getAsset(query);
    queryEcho = query;
    if (!focusAsset) {
      return emptyPack(query, [`Asset not found: ${query}`]);
    }
  } else if (query) {
    queryEcho = query;
    const hits = await runHybrid(store, {
      query,
      project: options.project,
      type: options.type,
      limit: Math.max(altLimit + 1, 6),
    });
    if (hits.length === 0) {
      return emptyPack(query, [
        'No search hits — try another query or capture the knowledge first',
      ]);
    }
    focusAsset = hits[0]!.asset;
    for (const h of hits.slice(1, altLimit + 1)) {
      alternatives.push({
        id: h.asset.id,
        title: h.asset.title,
        type: h.asset.type,
        score: h.score,
        matchedBy: h.matchedBy,
      });
    }
    if (alternatives.length > 0) {
      hints.push(
        `Also consider alternatives (${alternatives.length}); prefer focus unless title mismatch`,
      );
    }
  } else {
    return emptyPack(undefined, ['Provide id or query']);
  }

  const focus = toBrief(focusAsset, bodyMax);
  const codeAnchors = mergeAnchors(focusAsset);

  const ego = await buildEgoGraph(store, focusAsset.id, {
    depth,
    nodeCap: neighborCap,
  });
  const neighborhood = ego
    ? {
        depth: ego.depth,
        truncated: ego.truncated,
        nodes: ego.nodes
          .filter((n) => n.id !== focusAsset!.id)
          .map((n) => ({
            id: n.id,
            title: n.title,
            type: n.type,
            hop: n.hop,
            project: n.project,
            hasCodeAnchors: n.hasCodeAnchors,
          })),
        links: ego.links,
      }
    : null;

  if (neighborhood?.truncated) {
    hints.push('Neighborhood truncated — raise neighborCap or lower depth if needed');
  }

  let problemStatus: ContextPack['problemStatus'] = null;
  if (focusAsset.type === 'problem') {
    const report = await getProblemStatus(store, focusAsset.id);
    if (!('error' in report)) {
      problemStatus = {
        problemId: report.problemId,
        title: report.title,
        status: report.status,
        summary: report.summary,
        solutions: report.solutions,
        outcomes: report.outcomes,
      };
      if (report.status === 'open') {
        hints.push('Problem is open — no solves edge yet');
      } else if (report.status === 'addressed') {
        hints.push('Problem addressed but not verified — need outcome verifies');
      }
    }
  }

  const relatedIds = await store.getRelated(focusAsset.id, 1);
  const related: PackAssetBrief[] = [];
  for (const rid of relatedIds.slice(0, 12)) {
    if (rid === focusAsset.id) continue;
    const a = await store.getAsset(rid);
    if (a) related.push(toBrief(a, Math.min(bodyMax, 600)));
  }

  if (codeAnchors.length === 0 && needsAnchors(focusAsset.type)) {
    hints.push('Focus has no code anchors — dig code before relying on this card');
  }

  return ContextPackSchema.parse({
    version: CONTEXT_PACK_VERSION,
    query: queryEcho,
    focus,
    alternatives,
    neighborhood,
    codeAnchors,
    problemStatus,
    related,
    hints,
  });
}

function emptyPack(query: string | undefined, hints: string[]): ContextPack {
  return ContextPackSchema.parse({
    version: CONTEXT_PACK_VERSION,
    query,
    focus: null,
    alternatives: [],
    neighborhood: null,
    codeAnchors: [],
    problemStatus: null,
    related: [],
    hints,
  });
}

function toBrief(asset: KnowledgeAsset, maxChars: number): PackAssetBrief {
  return {
    id: asset.id,
    title: asset.title,
    type: asset.type,
    project: asset.project,
    status: asset.status,
    confidence: asset.confidence,
    bodyExcerpt: truncate(asset.body, maxChars),
    tags: asset.tags ?? [],
    links: (asset.links ?? []).map((l) => ({ id: l.id, relation: l.relation })),
    related: asset.related ?? [],
  };
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

function mergeAnchors(asset: KnowledgeAsset) {
  const fromMeta = readCodeAnchors(asset.metadata);
  if (fromMeta.length > 0) return fromMeta;
  return extractCodeAnchors(asset.body);
}

function needsAnchors(type: string): boolean {
  return (
    type === 'architecture_design' ||
    type === 'tool_usage' ||
    type === 'code_snippet' ||
    type === 'process_spec'
  );
}

async function runHybrid(store: SqliteStore, q: SearchQuery) {
  const limit = q.limit ?? 10;
  const [fulltext, semantic] = await Promise.all([
    fulltextSearch(store, { ...q, limit }),
    semanticSearch(store, { ...q, limit }),
  ]);
  const seedIds = fulltext.slice(0, 3).map((r) => r.asset.id);
  const graph = await graphNeighborhoodSearch(store, seedIds, 1);
  return hybridSearch({ fulltext, semantic, graph })
    .map((r) => {
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
}
