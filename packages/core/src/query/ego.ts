import type { KnowledgeAsset, KnowledgeType } from '@kmind/shared';
import { readCodeAnchors } from '../compiler/code-anchors.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import type { HealthIssue } from '../health/rules/expiry.js';

export const EGO_DEFAULT_DEPTH = 2;
export const EGO_MAX_DEPTH = 5;
export const EGO_DEFAULT_NODE_CAP = 150;

export interface EgoNode {
  id: string;
  title: string;
  type: KnowledgeType;
  hop: number;
  project: string;
  status: string;
  ontologyClass: string;
  hasHealthIssue: boolean;
  /** True when metadata.codeAnchors is non-empty. */
  hasCodeAnchors: boolean;
  codeAnchorCount: number;
}

export interface EgoLink {
  source: string;
  target: string;
  relationType: string;
}

export interface EgoGraph {
  focusId: string;
  depth: number;
  nodeCap: number;
  truncated: boolean;
  totalCandidates: number;
  nodes: EgoNode[];
  links: EgoLink[];
}

/**
 * Build an ego neighborhood graph with hop shells and a hard node cap.
 * Focus node is always included (hop 0). Truncation prefers keeping lower hops.
 */
export async function buildEgoGraph(
  store: SqliteStore,
  focusId: string,
  options?: {
    depth?: number;
    nodeCap?: number;
    healthIssues?: HealthIssue[];
  },
): Promise<EgoGraph | null> {
  const focus = await store.getAsset(focusId);
  if (!focus) return null;

  const depth = Math.min(
    Math.max(1, options?.depth ?? EGO_DEFAULT_DEPTH),
    EGO_MAX_DEPTH,
  );
  const nodeCap = Math.max(1, options?.nodeCap ?? EGO_DEFAULT_NODE_CAP);
  const healthIds = new Set(
    (options?.healthIssues ?? [])
      .map((i) => i.assetId)
      .filter((id): id is string => Boolean(id)),
  );

  const relations = await store.getRelations();
  const adj = new Map<string, Set<string>>();
  for (const rel of relations) {
    addEdge(adj, rel.fromId, rel.toId);
    addEdge(adj, rel.toId, rel.fromId);
  }

  const hopOf = new Map<string, number>([[focusId, 0]]);
  let frontier = [focusId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nid of adj.get(cur) ?? []) {
        if (hopOf.has(nid)) continue;
        hopOf.set(nid, d + 1);
        next.push(nid);
      }
    }
    frontier = next;
  }

  const ordered = [...hopOf.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[0].localeCompare(b[0]);
  });
  const totalCandidates = ordered.length;
  const truncated = totalCandidates > nodeCap;
  const kept = ordered.slice(0, nodeCap);
  const keptIds = new Set(kept.map(([id]) => id));

  const nodes: EgoNode[] = [];
  for (const [id, hop] of kept) {
    const asset = id === focusId ? focus : await store.getAsset(id);
    if (!asset) continue;
    nodes.push(toEgoNode(asset, hop, healthIds.has(id)));
  }

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
    focusId,
    depth,
    nodeCap,
    truncated,
    totalCandidates,
    nodes,
    links,
  };
}

/**
 * Filter health issues to those touching the given node set.
 */
export function filterEgoHealthIssues(
  issues: HealthIssue[],
  nodeIds: Set<string>,
): HealthIssue[] {
  return issues.filter((i) => i.assetId && nodeIds.has(i.assetId));
}

function toEgoNode(
  asset: KnowledgeAsset,
  hop: number,
  hasHealthIssue: boolean,
): EgoNode {
  const anchors = readCodeAnchors(asset.metadata);
  return {
    id: asset.id,
    title: asset.title,
    type: asset.type,
    hop,
    project: asset.project,
    status: asset.status,
    ontologyClass: asset.ontologyClass,
    hasHealthIssue,
    hasCodeAnchors: anchors.length > 0,
    codeAnchorCount: anchors.length,
  };
}

function addEdge(
  adj: Map<string, Set<string>>,
  from: string,
  to: string,
): void {
  let set = adj.get(from);
  if (!set) {
    set = new Set();
    adj.set(from, set);
  }
  set.add(to);
}
