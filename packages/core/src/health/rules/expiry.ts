import type { KnowledgeAsset } from '@kmind/shared';

export interface HealthIssue {
  rule: string;
  severity: 'low' | 'medium' | 'high';
  assetId?: string;
  message: string;
}

/**
 * Flag assets past expiresAt or older than expiryDays.
 */
export function checkExpiry(
  assets: KnowledgeAsset[],
  expiryDays: number,
): HealthIssue[] {
  const now = Date.now();
  const issues: HealthIssue[] = [];
  for (const a of assets) {
    if (a.expiresAt && Date.parse(a.expiresAt) < now) {
      issues.push({
        rule: 'expiry',
        severity: 'medium',
        assetId: a.id,
        message: `Asset expired at ${a.expiresAt}`,
      });
    }
    const ageDays = (now - Date.parse(a.timestamp)) / (1000 * 60 * 60 * 24);
    if (ageDays > expiryDays && a.status === 'draft') {
      issues.push({
        rule: 'expiry',
        severity: 'low',
        assetId: a.id,
        message: `Draft older than ${expiryDays} days`,
      });
    }
  }
  return issues;
}
