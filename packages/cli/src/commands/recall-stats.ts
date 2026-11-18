import { summarizeSearchQueryLogs } from '@kmind/core';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 168;

/**
 * Clamp window hours to [1, 168].
 */
export function clampRecallWindowHours(raw: number | undefined): number {
  const n = Number.isFinite(raw) ? Math.floor(Number(raw)) : DEFAULT_WINDOW_HOURS;
  if (n < 1) return 1;
  if (n > MAX_WINDOW_HOURS) return MAX_WINDOW_HOURS;
  return n;
}

/**
 * Print or JSON-emit local recall stats from audit/search-queries.
 */
export async function cmdRecallStats(
  ctx: AppContext,
  options: { project?: string; windowHours?: number } = {},
): Promise<void> {
  const windowHours = clampRecallWindowHours(options.windowHours);
  const project = options.project?.trim() || undefined;
  const report = await summarizeSearchQueryLogs({
    auditDir: ctx.vault.auditDir,
    windowHours,
    project,
  });
  success(report, ctx.json);
}
