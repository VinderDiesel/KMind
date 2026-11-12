import { assessCoverageWithProtocol } from '@kmind/core';
import type { AppContext } from '../context.js';
import { fail, success } from '../exit.js';
import { KMindError } from '@kmind/shared';

/**
 * Assess project/topic coverage (dug deep vs catalog-only).
 */
export async function cmdCoverage(
  ctx: AppContext,
  options: { project: string; topic?: string; hubId?: string },
): Promise<void> {
  const project = options.project.trim();
  if (!project || project === 'global') {
    fail(
      new KMindError('coverage: 必须传明确 --project（禁止缺省/global）', {
        category: 'GRAPH_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion: '例如 --project meta-brain --topic 问数',
      }),
      ctx.json,
    );
  }
  const report = await assessCoverageWithProtocol(ctx.vault, ctx.store, {
    project,
    topic: options.topic,
    hubId: options.hubId,
  });
  if (ctx.json) {
    success(report, true);
    return;
  }
  process.stdout.write(`${report.summary}\n`);
  process.stdout.write(
    `claimCompleteAllowed=${report.claimCompleteAllowed} recentRecall=${report.recentRecall.status}\n`,
  );
  if (report.protocolViolation.length) {
    process.stdout.write('\nProtocol violations:\n');
    for (const v of report.protocolViolation) {
      process.stdout.write(`- [${v.severity}] ${v.code}: ${v.message}\n`);
    }
  }
  if (report.nextActions.length) {
    process.stdout.write('\nNext actions:\n');
    for (const a of report.nextActions) {
      process.stdout.write(`- ${a}\n`);
    }
  }
  if (report.issues.length) {
    process.stdout.write(`\nIssues (${report.issues.length}):\n`);
    for (const i of report.issues.slice(0, 20)) {
      process.stdout.write(
        `- [${i.severity}] ${i.code}: ${i.message}${i.assetId ? ` (${i.assetId})` : ''}\n`,
      );
    }
  }
}
