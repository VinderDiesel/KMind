import { MarkdownStore, retireExpired, deprecateAllExpired } from '@kmind/core';
import { KMindError } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { fail, success } from '../exit.js';

/**
 * Expire-card retirement CLI (list / deprecate / supersede / refresh / deprecate-all).
 */
export async function cmdExpiry(
  ctx: AppContext,
  options: {
    action: string;
    id?: string;
    by?: string;
    project?: string;
    expiresAt?: string;
    dryRun?: boolean;
  },
): Promise<void> {
  try {
    const assets = await ctx.store.queryAssets({ limit: 100_000 });
    const markdown = new MarkdownStore(ctx.vault.knowledgeDir);
    const action = options.action.trim();

    if (action === 'deprecate-all') {
      const project = options.project?.trim() ?? '';
      const result = await deprecateAllExpired({
        store: ctx.store,
        markdown,
        assets,
        project,
        dryRun: options.dryRun,
      });
      success(result, ctx.json);
      return;
    }

    const result = await retireExpired({
      store: ctx.store,
      markdown,
      assets,
      action: action as 'list' | 'deprecate' | 'supersede' | 'refresh',
      id: options.id,
      by: options.by,
      project: options.project,
      expiresAt: options.expiresAt,
      dryRun: options.dryRun,
    });
    success(result, ctx.json);
  } catch (err) {
    fail(
      err instanceof KMindError
        ? err
        : new KMindError(String(err), {
            category: 'GRAPH_ERROR',
            severity: 'medium',
            retryable: false,
            suggestion: '检查 action / --id / --by / --project 参数',
          }),
      ctx.json,
    );
  }
}
