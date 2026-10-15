import { createQueryEngine } from '@kmind/core';
import type { KnowledgeType } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Hybrid search.
 */
export async function cmdSearch(
  ctx: AppContext,
  query: string,
  options: { type?: string; limit?: number; project?: string },
): Promise<void> {
  const engine = createQueryEngine(ctx.vault, ctx.store);
  const results = await engine.search({
    query,
    type: options.type as KnowledgeType | undefined,
    project: options.project,
    limit: options.limit ?? 10,
  });
  if (ctx.json) {
    success(results, true);
    return;
  }
  if (results.length === 0) {
    process.stdout.write('No results.\n');
    return;
  }
  for (const r of results) {
    process.stdout.write(
      `[${r.score.toFixed(3)}] ${r.asset.id} ${r.asset.title} (${r.matchedBy.join(',')})\n`,
    );
  }
}
