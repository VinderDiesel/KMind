import type { KnowledgeAsset, KnowledgeType } from '@kmind/shared';
import { readCodeAnchors } from '../compiler/code-anchors.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import type { HealthIssue } from '../health/rules/expiry.js';
import type { EgoLink, EgoNode } from './ego.js';

export const GLOBAL_DEFAULT_NODE_CAP = 300;
export const GLOBAL_MAX_NODE_CAP = 2000;

export interface GlobalGraph {
  mode: 'global';
  nodeCap: number;
  truncated: boolean;
  totalCandidates: number;
  project?: string;
  types?: KnowledgeType[];
  nodes: EgoNode[];
  links: EgoLink[];
}

/**
 * Build a vault-wide graph with optional project/type filters and a hard node cap.
 * Truncation prefers nodes that participate in at least one relation.
 */
export async function buildGlobalGraph(
  store: SqliteStore,
  options?: {
    project?: string;
    types?: KnowledgeType[];
    nodeCap?: number;
    healthIssues?: HealthIssue[];
  },
): Promise<GlobalGraph> {
  const nodeCap = Math.min(
    Math.max(1, options?.nodeCap ?? GLOBAL_DEFAULT_NODE_CAP),
    GLOBAL_MAX_NODE_CAP,
  );
  const healthIds = new Set(
    (options?.healthIssues ?? [])
      .map((i) => i.assetId)
      .filter((id): id is string => Boolean(id)),
  );
  const typeFilter =
    options?.types && options.types.length > 0
      ? new Set(options.types)
      : null;

  const assets =
    options?.types?.length === 1
      ? await store.queryAssets({
          project: options.project,
          type: options.types[0],
          limit: GLOBAL_MAX_NODE_CAP + 1,
        })
      : await store.queryAssets({
          project: options?.project,
          limit: GLOBAL_MAX_NODE_CAP + 1,
        });
  const candidates = typeFilter
    ? assets.filter((a) => typeFilter.has(a.type))
    : assets;

  const relations = await store.getRelations();
  const candidateIds = new Set(candidates.map((a) => a.id));
  const degree = new Map<string, number>();
  for (const rel of relations) {
    if (!candidateIds.has(rel.fromId) || !candidateIds.has(rel.toId)) continue;
    degree.set(rel.fromId, (degree.get(rel.fromId) ?? 0) + 1);
    degree.set(rel.toId, (degree.get(rel.toId) ?? 0) + 1);
  }

  const ordered = [...candidates].sort((a, b) => {
    const da = degree.get(a.id) ?? 0;
    const db = degree.get(b.id) ?? 0;
    if (da !== db) return db - da;
    return a.id.localeCompare(b.id);
  });

  const totalCandidates = ordered.length;
  const truncated = totalCandidates > nodeCap;
  const kept = ordered.slice(0, nodeCap);
  const keptIds = new Set(kept.map((a) => a.id));

  const nodes: EgoNode[] = kept.map((asset) =>
    toNode(asset, healthIds.has(asset.id)),
  );

  const links: EgoLink[] = [];
  for (const rel of relations) {
    if (!keptIds.has(rel.fromId) || !keptIds.has(rel.toId)) continue;
    links.push({
      source: rel.fromId,
      target: rel.toId,
      relationType: rel.relationType,
    });
  }

  return {
    mode: 'global',
    nodeCap,
    truncated,
    totalCandidates,
    project: options?.project,
    types: options?.types,
    nodes,
    links,
  };
}

function toNode(asset: KnowledgeAsset, hasHealthIssue: boolean): EgoNode {
  const anchors = readCodeAnchors(asset.metadata);
  return {
    id: asset.id,
    title: asset.title,
    type: asset.type,
    hop: 0,
    project: asset.project,
    status: asset.status,
    ontologyClass: asset.ontologyClass,
    hasHealthIssue,
    hasCodeAnchors: anchors.length > 0,
    codeAnchorCount: anchors.length,
  };
}
