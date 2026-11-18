import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  BOOTSTRAP_PROGRESS_VERSION,
  BootstrapProgressSchema,
  type BootstrapPlan,
  type BootstrapProgress,
  type DigTaskStatus,
} from '@kmind/shared';
import type { Vault } from '../storage/vault.js';

/**
 * Path for bootstrap progress under vault audit/.
 */
export function bootstrapProgressPath(vault: Vault): string {
  return path.join(vault.auditDir, 'bootstrap-progress.json');
}

/**
 * Load progress (empty default when missing / invalid).
 */
export async function loadBootstrapProgress(
  vault: Vault,
  project: string,
): Promise<BootstrapProgress | null> {
  const file = bootstrapProgressPath(vault);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = BootstrapProgressSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (parsed.data.project !== project) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Persist progress atomically.
 */
export async function saveBootstrapProgress(
  vault: Vault,
  progress: BootstrapProgress,
): Promise<string> {
  await fs.mkdir(vault.auditDir, { recursive: true });
  const file = bootstrapProgressPath(vault);
  const tmp = `${file}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(BootstrapProgressSchema.parse(progress), null, 2)}\n`;
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, file);
  return file;
}

/**
 * Stable hash of plan task ids + paths (for resume affinity).
 */
export function hashBootstrapPlan(plan: BootstrapPlan): string {
  const parts: string[] = [];
  for (const g of plan.groups) {
    for (const t of g.tasks) {
      parts.push(`${t.id}:${t.paths.join(',')}`);
    }
  }
  parts.sort();
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Merge progress marks onto plan tasks (progress wins for known ids).
 */
export function mergeProgressIntoPlan(
  plan: BootstrapPlan,
  progress: BootstrapProgress | null,
): BootstrapPlan {
  if (!progress || progress.tasks.length === 0) return plan;
  const byId = new Map(progress.tasks.map((t) => [t.id, t]));
  let tasksAlreadyDone = 0;
  const groups = plan.groups.map((g) => ({
    ...g,
    tasks: g.tasks.map((task) => {
      const mark = byId.get(task.id);
      if (!mark) {
        if (task.status === 'done') tasksAlreadyDone += 1;
        return task;
      }
      const next = {
        ...task,
        status: mark.status,
        assetId: mark.assetId ?? task.assetId,
      };
      if (next.status === 'done') tasksAlreadyDone += 1;
      return next;
    }),
  }));
  return {
    ...plan,
    groups,
    stats: { ...plan.stats, tasksAlreadyDone },
  };
}

/**
 * Upsert one task mark into progress.
 */
export function upsertProgressTask(
  progress: BootstrapProgress,
  taskId: string,
  status: DigTaskStatus,
  assetId?: string,
  now = new Date(),
): BootstrapProgress {
  const updatedAt = now.toISOString();
  const tasks = [...progress.tasks];
  const idx = tasks.findIndex((t) => t.id === taskId);
  const entry = {
    id: taskId,
    status,
    assetId,
    updatedAt,
  };
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx]!, ...entry };
  } else {
    tasks.push(entry);
  }
  return {
    ...progress,
    version: BOOTSTRAP_PROGRESS_VERSION,
    tasks,
    updatedAt,
  };
}

/**
 * Ensure a progress shell for project/repo.
 */
export function emptyBootstrapProgress(
  project: string,
  repoRoot: string,
  planHash?: string,
  now = new Date(),
): BootstrapProgress {
  return {
    version: BOOTSTRAP_PROGRESS_VERSION,
    project,
    repoRoot,
    planHash,
    tasks: [],
    updatedAt: now.toISOString(),
  };
}
