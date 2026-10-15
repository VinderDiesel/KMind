import type { KnowledgeAsset } from '@kmind/shared';
import type { HealthIssue } from './expiry.js';

/**
 * Detect related ids that do not exist.
 */
export function checkBrokenLinks(assets: KnowledgeAsset[]): HealthIssue[] {
  const ids = new Set(assets.map((a) => a.id));
  const issues: HealthIssue[] = [];
  for (const a of assets) {
    for (const rel of a.related) {
      if (!ids.has(rel)) {
        issues.push({
          rule: 'broken-links',
          severity: 'high',
          assetId: a.id,
          message: `Broken related link: ${rel}`,
        });
      }
    }
  }
  return issues;
}
