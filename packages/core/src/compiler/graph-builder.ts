import { createHash } from 'node:crypto';
import os from 'node:os';
import type { AssetLink, KnowledgeAsset } from '@kmind/shared';
import type { MappedKnowledge } from './ontology-mapper.js';
import type { SqliteStore } from '../storage/sqlite-store.js';

export interface GraphBuildInput {
  id: string;
  title: string;
  project: string;
  body: string;
  mapped: MappedKnowledge;
  rawPath: string;
  terminal: KnowledgeAsset['source']['terminal'];
  timestamp: string;
  metadata?: Record<string, unknown>;
  related?: string[];
  links?: AssetLink[];
}

/**
 * Build a KnowledgeAsset and persist relations.
 */
export class GraphBuilder {
  constructor(private readonly store: SqliteStore) {}

  build(input: GraphBuildInput): KnowledgeAsset {
    return {
      id: input.id,
      type: input.mapped.type,
      title: input.title,
      project: input.project,
      timestamp: input.timestamp,
      status: input.mapped.confidence >= 0.6 ? 'draft' : 'draft',
      confidence: input.mapped.confidence,
      expiresAt: null,
      source: {
        terminal: input.terminal,
        rawPath: input.rawPath,
        capturedAt: input.timestamp,
      },
      context: input.mapped.context,
      tags: input.mapped.tags,
      related: input.related ?? [],
      links: input.links ?? [],
      body: input.body,
      ontologyClass: input.mapped.ontologyClass,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.links?.length ? { links: input.links } : {}),
      },
    };
  }

  async persist(asset: KnowledgeAsset): Promise<void> {
    await this.store.upsertAsset(asset);
  }
}

/**
 * 4-hex author fingerprint from KMIND_AUTHOR or hostname (multi-writer anti-collision).
 */
export function authorIdSuffix(seed?: string): string {
  const raw =
    seed ??
    process.env.KMIND_AUTHOR ??
    process.env.USER ??
    process.env.USERNAME ??
    os.hostname() ??
    'anon';
  return createHash('sha256').update(raw).digest('hex').slice(0, 4);
}

/**
 * UTC day prefix `k-YYYY-MM-DD-` for id allocation.
 */
export function knowledgeIdDayPrefix(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `k-${y}-${m}-${d}-`;
}

/**
 * Parse daily sequence from `k-YYYY-MM-DD-NNN` or `k-YYYY-MM-DD-NNN-<4hex>`.
 */
export function parseKnowledgeIdSeq(
  id: string,
  dayPrefix: string,
): number | null {
  if (!id.startsWith(dayPrefix)) return null;
  const rest = id.slice(dayPrefix.length);
  const m = /^(\d+)(?:-[0-9a-f]{4})?$/i.exec(rest);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Generate next knowledge id: k-YYYY-MM-DD-NNN-<4hex>.
 */
export function nextKnowledgeId(
  date: Date,
  seq: number,
  authorSuffix?: string,
): string {
  const prefix = knowledgeIdDayPrefix(date);
  const suffix = authorSuffix ?? authorIdSuffix();
  return `${prefix}${String(seq).padStart(3, '0')}-${suffix}`;
}
