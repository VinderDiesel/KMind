import { createPipeline } from '@kmind/core';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Run the compile pipeline.
 */
export async function cmdCompile(
  ctx: AppContext,
  options: { incremental?: boolean; project?: string; force?: boolean },
): Promise<void> {
  const pipeline = createPipeline(ctx.vault, {
    sqlite: ctx.store,
    registry: ctx.registry,
    evolver: ctx.evolver,
    adapters: ctx.adapters,
  });
  const result = await pipeline.run({
    incremental: options.incremental ?? true,
    project: options.project,
    force: options.force,
  });
  if (ctx.json) {
    success(result, true);
  } else {
    process.stdout.write(
      `Compiled: processed=${result.processed} created=${result.created} skipped=${result.skipped} gated=${result.gated} failed=${result.failed.length} (${result.durationMs}ms)\n`,
    );
    if (result.failed.length) {
      for (const f of result.failed) {
        process.stdout.write(`  fail: ${f.path}: ${f.error}\n`);
      }
    }
    process.stdout.write(`${result.diagnosticsMarkdown}\n`);
  }
}
