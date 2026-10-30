import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  EVOLUTION_QUEUE_VERSION,
  EvolutionQueueSchema,
  type EvolutionQueue,
  type EvolutionTodo,
} from '@kmind/shared';
import type { Vault } from '../storage/vault.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import { runHealthCheck } from '../health/checker.js';
import { assessProjectCoverage } from '../query/coverage.js';

/**
 * Path for persisted evolution todo queue under vault audit/.
 */
export function evolutionQueuePath(vault: Vault): string {
  return path.join(vault.auditDir, 'evolution-queue.json');
}

/**
 * Load evolution queue (empty default if missing).
 */
export async function loadEvolutionQueue(vault: Vault): Promise<EvolutionQueue> {
  const file = evolutionQueuePath(vault);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = EvolutionQueueSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    /* missing */
  }
  return emptyQueue(new Date().toISOString());
}

/**
 * Persist evolution queue.
 */
export async function saveEvolutionQueue(
  vault: Vault,
  queue: EvolutionQueue,
): Promise<void> {
  await fs.mkdir(vault.auditDir, { recursive: true });
  const file = evolutionQueuePath(vault);
  const tmp = `${file}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(EvolutionQueueSchema.parse(queue), null, 2)}\n`;
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, file);
}

export interface EvolutionScanResult {
  queue: EvolutionQueue;
  path: string;
}

/**
 * Scan lint + per-project coverage into an evolution todo queue (ADR-002).
 * Diagnosis only — does not capture or rewrite assets.
 */
export async function runEvolutionScan(
  vault: Vault,
  store: SqliteStore,
): Promise<EvolutionScanResult> {
  const scannedAt = new Date().toISOString();
  const prev = await loadEvolutionQueue(vault);
  const preserved = new Map(
    prev.items
      .filter((i) => i.status === 'done' || i.status === 'dismissed')
      .map((i) => [i.id, i]),
  );

  const byId = new Map<string, EvolutionTodo>();
  const upsert = (todo: EvolutionTodo) => {
    const prevTodo = byId.get(todo.id);
    if (!prevTodo) {
      byId.set(todo.id, todo);
      return;
    }
    // Prefer higher severity; keep preserved non-open status.
    const rank = { high: 0, medium: 1, low: 2 };
    if (rank[todo.severity] < rank[prevTodo.severity]) {
      byId.set(todo.id, { ...todo, status: prevTodo.status });
    }
  };

  const health = await runHealthCheck(vault, store);
  for (const issue of health.issues) {
    const id = todoId(
      'health',
      issue.rule,
      `${issue.assetId ?? ''}:${issue.message}`,
    );
    const kept = preserved.get(id);
    upsert({
      id,
      source: 'health',
      severity: issue.severity,
      assetId: issue.assetId,
      code: issue.rule,
      message: issue.message,
      nextAction: `Fix health:${issue.rule}${issue.assetId ? ` on ${issue.assetId}` : ''} — ${issue.message}`,
      status: kept?.status ?? 'open',
      updatedAt: scannedAt,
    });
  }

  const assets = await store.queryAssets({ limit: 100_000 });
  const projects = [
    ...new Set(
      assets
        .map((a) => a.project)
        .filter((p) => p && p !== 'global'),
    ),
  ].sort();

  for (const project of projects) {
    const report = assessProjectCoverage(assets, { project });
    for (const issue of report.issues) {
      const id = todoId(
        'coverage',
        issue.code,
        `${project}:${issue.assetId ?? ''}:${issue.message}`,
      );
      const kept = preserved.get(id);
      upsert({
        id,
        source: 'coverage',
        severity: issue.severity,
        project,
        assetId: issue.assetId,
        code: issue.code,
        message: issue.message,
        nextAction: report.nextActions[0],
        status: kept?.status ?? 'open',
        updatedAt: scannedAt,
      });
    }
    for (const action of report.nextActions.slice(0, 5)) {
      const id = todoId('coverage', 'next_action', `${project}:${action}`);
      const kept = preserved.get(id);
      upsert({
        id,
        source: 'coverage',
        severity: report.complete ? 'low' : 'medium',
        project,
        code: 'next_action',
        message: action,
        nextAction: action,
        status: kept?.status ?? 'open',
        updatedAt: scannedAt,
      });
    }
  }

  // Keep preserved done/dismissed that disappeared from scan (history).
  for (const [id, item] of preserved) {
    if (!byId.has(id)) {
      byId.set(id, item);
    }
  }

  const items = [...byId.values()];

  const open = items.filter((i) => i.status === 'open');
  const queue = EvolutionQueueSchema.parse({
    version: EVOLUTION_QUEUE_VERSION,
    scannedAt,
    items: rankItems(items),
    summary: {
      open: open.length,
      high: open.filter((i) => i.severity === 'high').length,
      medium: open.filter((i) => i.severity === 'medium').length,
      low: open.filter((i) => i.severity === 'low').length,
      projects: projects.length,
    },
  });

  await saveEvolutionQueue(vault, queue);
  return { queue, path: evolutionQueuePath(vault) };
}

/**
 * Mark a todo done/dismissed/open without re-scanning.
 */
export async function updateEvolutionTodoStatus(
  vault: Vault,
  todoIdValue: string,
  status: EvolutionTodo['status'],
): Promise<EvolutionQueue> {
  const queue = await loadEvolutionQueue(vault);
  const now = new Date().toISOString();
  const items = queue.items.map((i) =>
    i.id === todoIdValue ? { ...i, status, updatedAt: now } : i,
  );
  const open = items.filter((i) => i.status === 'open');
  const next = EvolutionQueueSchema.parse({
    ...queue,
    items,
    summary: {
      ...queue.summary,
      open: open.length,
      high: open.filter((i) => i.severity === 'high').length,
      medium: open.filter((i) => i.severity === 'medium').length,
      low: open.filter((i) => i.severity === 'low').length,
    },
  });
  await saveEvolutionQueue(vault, next);
  return next;
}

function emptyQueue(scannedAt: string): EvolutionQueue {
  return EvolutionQueueSchema.parse({
    version: EVOLUTION_QUEUE_VERSION,
    scannedAt,
    items: [],
    summary: { open: 0, high: 0, medium: 0, low: 0, projects: 0 },
  });
}

function todoId(source: string, code: string, key: string): string {
  const h = createHash('sha1')
    .update(`${source}|${code}|${key}`)
    .digest('hex')
    .slice(0, 12);
  return `${source}:${code}:${h}`;
}

function rankItems(items: EvolutionTodo[]): EvolutionTodo[] {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...items].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'open' ? -1 : b.status === 'open' ? 1 : 0;
    }
    return rank[a.severity] - rank[b.severity];
  });
}
