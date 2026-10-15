import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { KnowledgeAsset, Ontology } from '@kmind/shared';
import { OntologyRegistry } from './ontology-registry.js';
import { loadOntology, saveOntology } from './ontology-loader.js';

/** High-confidence threshold for promoting Soup → Ontology. */
export const EVOLVER_CONFIDENCE_THRESHOLD = 0.9;
/** Consecutive periods a candidate must under-perform before demotion. */
export const EVOLVER_DEMOTE_PERIODS = 3;

export interface OntologyProposal {
  id: string;
  kind: 'add_class' | 'add_property' | 'add_relation';
  payload: Record<string, unknown>;
  confidence: number;
  reason: string;
  layer: 'soup' | 'ontology';
  createdAt: string;
}

export interface OntologyVersion {
  version: string;
  appliedAt: string;
  proposalId: string;
}

/**
 * Ontology evolution with safety boundaries:
 * - Only promote concepts above high confidence threshold
 * - Never demote fixed classes
 * - New concepts start in Soup (candidate) layer
 */
export class OntologyEvolver {
  private readonly historyLog: OntologyVersion[] = [];
  private hitCounts = new Map<string, number>();

  constructor(
    private readonly ontologyDir: string,
    private readonly registry: OntologyRegistry,
  ) {}

  /**
   * Propose an ontology extension if the asset does not fit existing classes.
   */
  propose(asset: Partial<KnowledgeAsset>): OntologyProposal | null {
    if (!asset.type || !asset.ontologyClass) return null;
    const existing = this.registry.getClass(asset.ontologyClass);
    if (existing) return null;
    if ((asset.confidence ?? 0) < EVOLVER_CONFIDENCE_THRESHOLD) return null;

    const id = `prop-${Date.now()}`;
    return {
      id,
      kind: 'add_class',
      payload: {
        name: asset.ontologyClass,
        parent: 'KnowledgeAsset',
        properties: {
          decision: { type: 'text', required: true },
        },
      },
      confidence: asset.confidence ?? 0.9,
      reason: `Asset type ${asset.type} mapped to unknown class ${asset.ontologyClass}`,
      layer: 'soup',
      createdAt: new Date().toISOString(),
    };
  }

  /** Record a retrieval hit for feedback-driven promotion. */
  recordHit(className: string): void {
    this.hitCounts.set(className, (this.hitCounts.get(className) ?? 0) + 1);
  }

  /** Whether a soup class should be promoted based on hits. */
  shouldPromote(className: string, minHits = 5): boolean {
    if (this.registry.isFixed(className)) return false;
    return (this.hitCounts.get(className) ?? 0) >= minHits;
  }

  /**
   * Apply a proposal after human confirmation. Never demotes fixed classes.
   */
  async apply(proposal: OntologyProposal): Promise<void> {
    const ontology = await loadOntology(this.ontologyDir);
    if (proposal.kind === 'add_class') {
      const name = String(proposal.payload.name);
      if (this.registry.isFixed(name)) {
        return;
      }
      ontology.classes[name] = {
        parent: String(proposal.payload.parent ?? 'KnowledgeAsset'),
        abstract: false,
        properties: (proposal.payload.properties as Ontology['classes'][string]['properties']) ?? {},
      };
      bumpVersion(ontology);
    }
    await saveOntology(this.ontologyDir, ontology);
    this.registry.load(ontology);
    this.historyLog.push({
      version: ontology.version,
      appliedAt: new Date().toISOString(),
      proposalId: proposal.id,
    });
    await this.persistProposal(proposal, 'applied');
  }

  /** Persist proposal for human review. */
  async saveProposal(proposal: OntologyProposal): Promise<void> {
    await this.persistProposal(proposal, 'pending');
  }

  history(): OntologyVersion[] {
    return [...this.historyLog];
  }

  private async persistProposal(
    proposal: OntologyProposal,
    status: string,
  ): Promise<void> {
    const dir = path.join(this.ontologyDir, 'proposals');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${proposal.id}.json`),
      JSON.stringify({ ...proposal, status }, null, 2),
      'utf8',
    );
  }
}

function bumpVersion(ontology: Ontology): void {
  const [major, minor] = ontology.version.split('.').map(Number);
  ontology.version = `${major}.${(minor ?? 0) + 1}`;
}
