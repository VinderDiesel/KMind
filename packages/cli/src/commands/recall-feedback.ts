import { appendRecallFeedback } from '@kmind/core';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Append a local usefulness signal for pack/search (audit only).
 */
export async function cmdRecallFeedback(
  ctx: AppContext,
  options: {
    useful: boolean;
    focusId?: string;
    query?: string;
    note?: string;
  },
): Promise<void> {
  const path = await appendRecallFeedback(ctx.vault.auditDir, {
    useful: options.useful,
    focusId: options.focusId?.trim() || undefined,
    query: options.query?.trim() || undefined,
    note: options.note?.trim() || undefined,
    source: 'cli',
  });
  success({ ok: true, path, useful: options.useful }, ctx.json);
}
