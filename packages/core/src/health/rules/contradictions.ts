import type { HealthIssue } from './expiry.js';

/**
 * Detect pairs linked by contradicts relation.
 */
export function checkContradictions(
  relations: Array<{ fromId: string; toId: string; relationType: string }>,
): HealthIssue[] {
  return relations
    .filter((r) => r.relationType === 'contradicts')
    .map((r) => ({
      rule: 'contradictions',
      severity: 'medium' as const,
      assetId: r.fromId,
      message: `${r.fromId} contradicts ${r.toId}`,
    }));
}
