import type { BootstrapPlan, DigTask, KnowledgeType } from '@kmind/shared';
import type { Vault } from '../storage/vault.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import { buildBootstrapPlanForVault } from './vault-plan.js';

/**
 * Find a DigTask by id inside a BootstrapPlan.
 */
export function findDigTask(
  plan: BootstrapPlan,
  taskId: string,
): DigTask | undefined {
  const id = taskId.trim();
  if (!id) return undefined;
  for (const group of plan.groups) {
    const hit = group.tasks.find((t) => t.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Resolve DigTask.candidateType for bootstrapTask alignment hints.
 */
export function lookupDigTaskCandidateType(
  plan: BootstrapPlan,
  taskId: string,
): KnowledgeType | undefined {
  return findDigTask(plan, taskId)?.candidateType;
}

/**
 * Build vault plan and look up DigTask.candidateType (best-effort).
 */
export async function resolveBootstrapCandidateType(
  vault: Vault,
  store: SqliteStore,
  project: string,
  taskId: string,
): Promise<KnowledgeType | undefined> {
  const id = taskId.trim();
  if (!id) return undefined;
  try {
    const plan = await buildBootstrapPlanForVault(vault, store, { project });
    return lookupDigTaskCandidateType(plan, id);
  } catch {
    return undefined;
  }
}
