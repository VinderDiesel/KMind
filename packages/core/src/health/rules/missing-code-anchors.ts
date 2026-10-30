import type { KnowledgeAsset, KnowledgeType } from '@kmind/shared';
import { assetHasCodeAnchors } from '../../compiler/code-anchors.js';
import { isOverviewTitle } from '../../compiler/capture-quality.js';
import type { HealthIssue } from './expiry.js';

const ANCHOR_TYPES: ReadonlySet<KnowledgeType> = new Set([
  'architecture_design',
  'code_snippet',
]);

/**
 * Low-severity lint: architecture / snippet assets should cite code anchors.
 * Accepts metadata.codeAnchors OR body ## 代码锚点 / path:line (same as capture gate).
 * Overview hubs and process_spec are exempt (doc/nav cards).
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
    if (isOverviewTitle(a.title)) continue;
    if (assetHasCodeAnchors(a.body, a.metadata)) continue;
    issues.push({
      rule: 'missing_code_anchors',
      severity: 'low',
      assetId: a.id,
      message: `${a.type} has no codeAnchors (add ## 代码锚点 or path:line; compile/reindex writes metadata)`,
    });
  }
  return issues;
}
