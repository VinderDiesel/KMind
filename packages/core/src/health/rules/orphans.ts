import type { KnowledgeAsset } from '@kmind/shared';
import type { HealthIssue } from './expiry.js';

/**
 * Assets with no related links and no incoming relations.
 */
export function checkOrphans(
  assets: KnowledgeAsset[],
  relations: Array<{ fromId: string; toId: string }>,
): HealthIssue[] {
  const linked = new Set<string>();
  for (const r of relations) {
    linked.add(r.fromId);
    linked.add(r.toId);
  }
  for (const a of assets) {
    for (const rel of a.related) linked.add(rel);
    if (a.related.length) linked.add(a.id);
  }
  return assets
    .filter((a) => !linked.has(a.id))
    .map((a) => ({
      rule: 'orphans',
      severity: 'low' as const,
      assetId: a.id,
      message: `Orphan asset with no relations: ${a.title}`,
    }));
}
