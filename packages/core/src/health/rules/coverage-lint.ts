import type { KnowledgeAsset } from '@kmind/shared';
import { assessProjectCoverage } from '../../query/coverage.js';
import type { HealthIssue } from './expiry.js';

/**
 * Lint shallow details + duplicate overviews per project via coverage assessor.
 */
export function checkCoverageQuality(assets: KnowledgeAsset[]): HealthIssue[] {
  const projects = [...new Set(assets.map((a) => a.project).filter(Boolean))];
  const issues: HealthIssue[] = [];
  for (const project of projects) {
    const report = assessProjectCoverage(assets, { project });
    for (const i of report.issues) {
      if (i.severity === 'low' && i.code === 'empty_outbound') continue;
      issues.push({
        rule: `coverage_${i.code}`,
        severity: i.severity,
        assetId: i.assetId,
        message: i.message,
      });
    }
  }
  return issues;
}
