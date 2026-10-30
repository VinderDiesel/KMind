import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Rebuild SQLite index from Markdown knowledge assets.
 * Also backfills metadata.codeAnchors from body ## 代码锚点 / path:line.
 */
export async function cmdReindex(ctx: AppContext): Promise<void> {
  await ctx.store.rebuildFromMarkdown(ctx.vault.knowledgeDir);
  const count = await ctx.store.countAssets();
  success(
    {
      reindexed: true,
      assetCount: count,
      note: 'codeAnchors backfilled from body when missing',
    },
    ctx.json,
  );
}
