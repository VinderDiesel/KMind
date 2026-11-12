import type { AppContext } from '../context.js';
import { success } from '../exit.js';
import { ensureProjectFeatureTree, FEATURE_TREE_FILENAME } from './feature-tree.js';

/**
 * Ensure FEATURE_TREE.md under the resolved vault (project or home).
 */
export async function cmdFeatureTreeEnsure(ctx: AppContext): Promise<void> {
  const result = await ensureProjectFeatureTree(ctx.vault.root);
  success(
    {
      ok: true,
      ...result,
      file: FEATURE_TREE_FILENAME,
      message: `FEATURE_TREE ${result.action} at ${result.path}`,
    },
    ctx.json,
  );
}
