import type { KnowledgeAsset, KnowledgeType } from '@kmind/shared';
import { readCodeAnchors } from '../../compiler/code-anchors.js';
import type { HealthIssue } from './expiry.js';

const ANCHOR_TYPES: ReadonlySet<KnowledgeType> = new Set([
  'architecture_design',
  'code_snippet',
]);

/**
 * Low-severity lint: architecture / snippet assets should cite code anchors.
 */
export function checkMissingCodeAnchors(
  assets: KnowledgeAsset[],
  enabled: boolean,
): HealthIssue[] {
  if (!enabled) return [];
  const issues: HealthIssue[] = [];
  for (const a of assets) {
    if (!ANCHOR_TYPES.has(a.type)) continue;
    if (a.status === 'deprecated') continue;
    const anchors = readCodeAnchors(a.metadata);
    if (anchors.length > 0) continue;
    issues.push({
      rule: 'missing_code_anchors',
      severity: 'low',
      assetId: a.id,
      message: `${a.type} has no codeAnchors (add ## 代码锚点 or path:line citations)`,
    });
  }
  return issues;
}
