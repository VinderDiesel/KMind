import {
  loadEvolutionQueue,
  runEvolutionScan,
  updateEvolutionTodoStatus,
} from '@kmind/core';
import { KMindError } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { fail, success } from '../exit.js';

/**
 * Refresh coverage + lint evolution queue (ADR-002). Does not capture.
 */
export async function cmdEvolutionScan(ctx: AppContext): Promise<void> {
  const result = await runEvolutionScan(ctx.vault, ctx.store);
  success(
    {
      scanned: true,
      path: result.path,
      summary: result.queue.summary,
      open: result.queue.items
        .filter((i) => i.status === 'open')
        .slice(0, 30),
    },
    ctx.json,
  );
}

/**
 * Show persisted evolution queue.
 */
export async function cmdEvolutionStatus(
  ctx: AppContext,
  options: { all?: boolean; limit?: number },
): Promise<void> {
  const queue = await loadEvolutionQueue(ctx.vault);
  const items = options.all
    ? queue.items
    : queue.items.filter((i) => i.status === 'open');
  const limit = options.limit ?? 50;
  if (ctx.json) {
    success(
      {
        scannedAt: queue.scannedAt,
        summary: queue.summary,
        items: items.slice(0, limit),
      },
      true,
    );
    return;
  }
  process.stdout.write(
    `Evolution queue scannedAt=${queue.scannedAt} open=${queue.summary.open} high=${queue.summary.high}\n`,
  );
  for (const i of items.slice(0, limit)) {
    process.stdout.write(
      `- [${i.severity}/${i.source}] ${i.code}: ${i.message}` +
        (i.project ? ` (project=${i.project})` : '') +
        (i.assetId ? ` [${i.assetId}]` : '') +
        `\n`,
    );
  }
}

/**
 * Mark a queue item done or dismissed (human/Agent after fixing).
 */
export async function cmdEvolutionAck(
  ctx: AppContext,
  todoId: string,
  status: 'done' | 'dismissed' | 'open',
): Promise<void> {
  if (!todoId.trim()) {
    fail(
      new KMindError('todo id required', {
        category: 'CONFIG_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion: 'Pass id from `kmind evolution status --json`',
      }),
      ctx.json,
    );
  }
  const queue = await updateEvolutionTodoStatus(
    ctx.vault,
    todoId.trim(),
    status,
  );
  success(
    {
      id: todoId.trim(),
      status,
      summary: queue.summary,
    },
    ctx.json,
  );
}
