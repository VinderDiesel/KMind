import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Initialize a vault directory.
 */
export async function cmdInit(ctx: AppContext): Promise<void> {
  await ctx.vault.init();
  await ctx.store.migrate();
  success(
    {
      ok: true,
      vaultPath: ctx.vault.root,
      message: `Initialized vault at ${ctx.vault.root}`,
    },
    ctx.json,
  );
}
