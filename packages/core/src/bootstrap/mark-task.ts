import type {
  BootstrapProgress,
  DigTaskStatus,
} from '@kmind/shared';
import type { Vault } from '../storage/vault.js';
import {
  emptyBootstrapProgress,
  loadBootstrapProgress,
  saveBootstrapProgress,
  upsertProgressTask,
} from './progress.js';

export interface MarkBootstrapProgressTaskInput {
  vault: Vault;
  project: string;
  repoRoot: string;
  taskId: string;
  status: DigTaskStatus;
  assetId?: string;
  planHash?: string;
}

export interface MarkBootstrapProgressTaskResult {
  progress: BootstrapProgress;
  path: string;
}

/**
 * Upsert one DigTask mark under audit/bootstrap-progress.json.
 */
export async function markBootstrapProgressTask(
  input: MarkBootstrapProgressTaskInput,
): Promise<MarkBootstrapProgressTaskResult> {
  let progress =
    (await loadBootstrapProgress(input.vault, input.project)) ??
    emptyBootstrapProgress(
      input.project,
      input.repoRoot,
      input.planHash,
    );
  progress = {
    ...progress,
    repoRoot: input.repoRoot,
    planHash: input.planHash ?? progress.planHash,
  };
  progress = upsertProgressTask(
    progress,
    input.taskId,
    input.status,
    input.assetId,
  );
  const path = await saveBootstrapProgress(input.vault, progress);
  return { progress, path };
}
