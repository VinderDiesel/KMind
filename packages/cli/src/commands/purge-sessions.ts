import { promises as fs } from 'node:fs';
import { MarkdownStore } from '@kmind/core';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Remove knowledge assets compiled from sessions/ raw (keep manual + raw files).
 * Use after a noisy adapter dump polluted the vault.
 */
export async function cmdPurgeSessions(
  ctx: AppContext,
  options: { dryRun?: boolean } = {},
): Promise<void> {
  const assets = await ctx.store.queryAssets({ limit: 100_000 });
  const victims = assets.filter(
    (a) =>
      a.source.rawPath.startsWith('sessions/') ||
      a.source.rawPath.includes('/sessions/'),
  );
  const markdown = new MarkdownStore(ctx.vault.knowledgeDir);
  let removed = 0;

  if (!options.dryRun) {
    for (const a of victims) {
      await ctx.store.deleteAsset(a.id);
      try {
        await fs.unlink(markdown.pathFor(a.id));
      } catch {
        /* file may be missing */
      }
      removed += 1;
    }
  }

  success(
    {
      dryRun: Boolean(options.dryRun),
      matched: victims.length,
      removed: options.dryRun ? 0 : removed,
      kept: assets.length - victims.length,
      hint: options.dryRun
        ? 'Re-run without --dry-run to delete. Raw sessions/ files are kept; capture.compileSessions defaults to false.'
        : 'Session-derived assets removed. Manual captures preserved.',
    },
    ctx.json,
  );
}
