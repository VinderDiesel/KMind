import type { KnowledgeAsset } from '@kmind/shared';
import type { OntologyRegistry } from '../../ontology/ontology-registry.js';
import type { HealthIssue } from './expiry.js';

/**
 * Assets whose ontologyClass is missing from registry.
 */
export function checkOntologyDrift(
  assets: KnowledgeAsset[],
  registry: OntologyRegistry,
): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const a of assets) {
    if (!registry.getClass(a.ontologyClass)) {
      issues.push({
        rule: 'ontology-drift',
        severity: 'medium',
        assetId: a.id,
        message: `Unknown ontology class: ${a.ontologyClass}`,
      });
    }
  }
  return issues;
}
