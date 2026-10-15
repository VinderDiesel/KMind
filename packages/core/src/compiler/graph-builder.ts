import type { KnowledgeAsset } from '@kmind/shared';
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
      related: [],
      body: input.body,
      ontologyClass: input.mapped.ontologyClass,
      metadata: {},
    };
  }

  async persist(asset: KnowledgeAsset): Promise<void> {
    await this.store.upsertAsset(asset);
  }
}

/**
 * Generate next knowledge id for a given day: k-YYYY-MM-DD-NNN.
 */
export function nextKnowledgeId(date: Date, seq: number): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `k-${y}-${m}-${d}-${String(seq).padStart(3, '0')}`;
}
