import type { ClassificationResult } from './classifier.js';
import type { OntologyRegistry } from '../ontology/ontology-registry.js';
import type { OntologyEvolver, OntologyProposal } from '../ontology/ontology-evolver.js';
import type { KnowledgeType } from '@kmind/shared';

export interface MappedKnowledge {
  type: KnowledgeType;
  ontologyClass: string;
  confidence: number;
  context: ClassificationResult['context'];
  tags: string[];
  proposal: OntologyProposal | null;
}

/**
 * Map classification result onto ontology classes.
 */
export class OntologyMapper {
  constructor(
    private readonly registry: OntologyRegistry,
    private readonly evolver?: OntologyEvolver,
  ) {}

  map(result: ClassificationResult): MappedKnowledge {
    const ontologyClass = this.registry.inferClass({ type: result.type });
    const proposal =
      this.evolver?.propose({
        type: result.type,
        ontologyClass,
        confidence: result.confidence,
        context: result.context,
      }) ?? null;

    return {
      type: result.type,
      ontologyClass,
      confidence: result.confidence,
      context: result.context,
      tags: result.tags,
      proposal,
    };
  }
}
