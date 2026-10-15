import { runHealthCheck } from '@kmind/core';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Run health checks and print Markdown report.
 */
export async function cmdLint(ctx: AppContext): Promise<void> {
  const report = await runHealthCheck(ctx.vault, ctx.store);
  if (ctx.json) {
    success(report, true);
  } else {
    process.stdout.write(`${report.markdown}\n`);
  }
}
