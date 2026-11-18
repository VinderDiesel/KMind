import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  applyBootstrapPlanToFeatureTree,
  buildBootstrapPlanForVault,
  buildDigPacket,
  hashBootstrapPlan,
  inferCodeRootFromVault,
  loadBootstrapProgress,
  markBootstrapProgressTask,
  summarizeDelegateGroups,
} from '@kmind/core';
import { DigTaskStatusEnum, KMindError } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { fail, success } from '../exit.js';
import {
  ensureProjectFeatureTree,
  featureTreePath,
} from './feature-tree.js';

/**
 * Resolve repo root for bootstrap (explicit --repo or parent of project vault).
 */
export function resolveBootstrapRepo(
  ctx: AppContext,
  repoOpt?: string,
): string {
  if (repoOpt?.trim()) {
    return path.resolve(repoOpt.trim());
  }
  return inferCodeRootFromVault(ctx.vault.root);
}

function requireProject(projectRaw: string, json: boolean): string {
  const project = projectRaw.trim();
  if (!project || project === 'global') {
    fail(
      new KMindError('bootstrap: 必须传明确 --project（禁止缺省/global）', {
        category: 'GRAPH_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion: '例如 --project meta-brain',
      }),
      json,
    );
  }
  return project;
}

/**
 * ADR-004: preview dig plan (no knowledge body).
 */
export async function cmdBootstrapPreview(
  ctx: AppContext,
  options: { project: string; repo?: string },
): Promise<void> {
  const project = requireProject(options.project, ctx.json);
  const repoRoot = resolveBootstrapRepo(ctx, options.repo);
  const plan = await buildBootstrapPlanForVault(ctx.vault, ctx.store, {
    project,
    repoRoot,
  });

  if (ctx.json) {
    success(plan, true);
    return;
  }

  process.stdout.write(
    `[kmind] bootstrap preview project=${plan.project} repo=${plan.repoRoot}\n`,
  );
  process.stdout.write(
    `[kmind] selected=${plan.stats.modulesSelected} excluded=${plan.stats.modulesExcluded} groups=${plan.stats.groupCount} tasks=${plan.stats.taskCount} done=${plan.stats.tasksAlreadyDone}\n`,
  );
  process.stdout.write(
    '[kmind] Plan is a dig checklist only — not knowledge complete.\n\n',
  );
  for (const group of plan.groups) {
    process.stdout.write(`## ${group.label} (priority=${group.priority})\n`);
    if (group.planNotes) {
      process.stdout.write(`planNotes: ${group.planNotes}\n`);
    }
    for (const task of group.tasks) {
      const mark = task.status === 'done' ? 'x' : ' ';
      process.stdout.write(
        `- [${mark}] ${task.id} · ${task.candidateType} · ${task.titleHint}\n`,
      );
      process.stdout.write(`  paths: ${task.paths.join(', ')}\n`);
      if (task.notes) process.stdout.write(`  notes: ${task.notes}\n`);
    }
    process.stdout.write('\n');
  }
}

/**
 * Write BootstrapPlan dig rows into vault FEATURE_TREE.md (no capture).
 */
export async function cmdBootstrapApplyTree(
  ctx: AppContext,
  options: { project: string; repo?: string },
): Promise<void> {
  const project = requireProject(options.project, ctx.json);
  const repoRoot = resolveBootstrapRepo(ctx, options.repo);
  const plan = await buildBootstrapPlanForVault(ctx.vault, ctx.store, {
    project,
    repoRoot,
  });

  await ensureProjectFeatureTree(ctx.vault.root);
  const treeFile = featureTreePath(ctx.vault.root);
  const existing = await fs.readFile(treeFile, 'utf8');
  const result = applyBootstrapPlanToFeatureTree(existing, plan);
  if (result.action !== 'unchanged') {
    await fs.writeFile(treeFile, result.next, 'utf8');
  }

  const payload = {
    path: treeFile,
    action: result.action,
    rowsWritten: result.rowsWritten,
    planStats: plan.stats,
  };
  if (ctx.json) {
    success(payload, true);
    return;
  }
  process.stdout.write(
    `[kmind] FEATURE_TREE ${result.action} → ${treeFile} (rows=${result.rowsWritten})\n`,
  );
}

/** Alias for apply-tree with progress-merged plan (sync done rows). */
export async function cmdBootstrapSyncTree(
  ctx: AppContext,
  options: { project: string; repo?: string },
): Promise<void> {
  await cmdBootstrapApplyTree(ctx, options);
}

/**
 * Show persisted bootstrap progress.
 */
export async function cmdBootstrapStatus(
  ctx: AppContext,
  options: { project: string },
): Promise<void> {
  const project = requireProject(options.project, ctx.json);
  const progress = await loadBootstrapProgress(ctx.vault, project);
  if (ctx.json) {
    success(progress ?? { project, tasks: [] }, true);
    return;
  }
  if (!progress) {
    process.stdout.write(`[kmind] no bootstrap progress for project=${project}\n`);
    return;
  }
  process.stdout.write(
    `[kmind] bootstrap progress project=${progress.project} updated=${progress.updatedAt} tasks=${progress.tasks.length}\n`,
  );
  for (const t of progress.tasks) {
    process.stdout.write(
      `- ${t.id} · ${t.status}${t.assetId ? ` · ${t.assetId}` : ''}\n`,
    );
  }
}

/**
 * Mark a dig task status in audit progress (no capture).
 */
export async function cmdBootstrapMark(
  ctx: AppContext,
  options: {
    project: string;
    task: string;
    status: string;
    asset?: string;
    repo?: string;
  },
): Promise<void> {
  const project = requireProject(options.project, ctx.json);
  const statusParse = DigTaskStatusEnum.safeParse(options.status);
  if (!statusParse.success) {
    fail(
      new KMindError('bootstrap mark: status must be todo|capturing|done', {
        category: 'GRAPH_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion: 'Use --status todo|capturing|done',
      }),
      ctx.json,
    );
  }
  const repoRoot = resolveBootstrapRepo(ctx, options.repo);
  const plan = await buildBootstrapPlanForVault(ctx.vault, ctx.store, {
    project,
    repoRoot,
  });
  const known = plan.groups.some((g) =>
    g.tasks.some((t) => t.id === options.task),
  );
  if (!known) {
    fail(
      new KMindError(`bootstrap mark: unknown task ${options.task}`, {
        category: 'GRAPH_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion: 'kmind bootstrap preview --json 查看 task id',
      }),
      ctx.json,
    );
  }

  const { path: file, progress } = await markBootstrapProgressTask({
    vault: ctx.vault,
    project,
    repoRoot,
    taskId: options.task,
    status: statusParse.data,
    assetId: options.asset,
    planHash: hashBootstrapPlan(plan),
  });
  if (ctx.json) {
    success({ path: file, progress }, true);
    return;
  }
  process.stdout.write(
    `[kmind] marked ${options.task} → ${statusParse.data} (${file})\n`,
  );
}

/**
 * Delegate dig packet for host agents.
 */
export async function cmdBootstrapDelegate(
  ctx: AppContext,
  options: { project: string; repo?: string; group?: string },
): Promise<void> {
  const project = requireProject(options.project, ctx.json);
  const repoRoot = resolveBootstrapRepo(ctx, options.repo);
  const plan = await buildBootstrapPlanForVault(ctx.vault, ctx.store, {
    project,
    repoRoot,
  });

  if (!options.group?.trim()) {
    const summary = summarizeDelegateGroups(plan);
    if (ctx.json) {
      success({ project, ...summary }, true);
      return;
    }
    process.stdout.write(
      `[kmind] bootstrap delegate groups for ${project} (pass --group <label>)\n`,
    );
    if (summary.recommendedNext) {
      process.stdout.write(
        `[kmind] recommendedNext=${summary.recommendedNext} open=${summary.stats.tasksOpen}\n`,
      );
    }
    for (const g of summary.groups) {
      process.stdout.write(
        `- ${g.label} priority=${g.priority} todo=${g.todoCount} done=${g.doneCount}\n`,
      );
    }
    return;
  }

  const packet = buildDigPacket({
    plan,
    groupLabel: options.group.trim(),
    skipDone: true,
  });
  if (ctx.json) {
    success(packet, true);
    return;
  }
  process.stdout.write(
    `[kmind] DigPacket group=${packet.groupLabel} tasks=${packet.tasks.length}\n`,
  );
  process.stdout.write(`${packet.acceptance.completeClaimForbiddenUntil}\n`);
  for (const t of packet.tasks) {
    process.stdout.write(
      `- ${t.id} · ${t.candidateType} · ${t.titleHint}\n  ${t.paths.join(', ')}\n`,
    );
  }
}

/**
 * After capture: mark bootstrap task done when --bootstrap-task is set.
 * Uses core mark helper (does not reject unknown task ids).
 */
export async function markBootstrapTaskAfterCapture(
  ctx: AppContext,
  options: { project: string; taskId: string; assetId?: string; repo?: string },
): Promise<void> {
  const repoRoot = resolveBootstrapRepo(ctx, options.repo);
  await markBootstrapProgressTask({
    vault: ctx.vault,
    project: options.project,
    repoRoot,
    taskId: options.taskId,
    status: 'done',
    assetId: options.assetId,
  });
}
