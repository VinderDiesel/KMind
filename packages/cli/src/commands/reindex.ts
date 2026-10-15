import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Rebuild SQLite index from Markdown knowledge assets.
 */
export async function cmdReindex(ctx: AppContext): Promise<void> {
  await ctx.store.rebuildFromMarkdown(ctx.vault.knowledgeDir);
  const count = await ctx.store.countAssets();
  success({ reindexed: true, assetCount: count }, ctx.json);
}
