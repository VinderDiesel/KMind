import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  applyBootstrapPlanToFeatureTree,
  assessCoverageWithProtocol,
  buildBootstrapPlanForVault,
  buildDigPacket,
  createLlmClient,
  hashBootstrapPlan,
  inferCodeRootFromVault,
  loadBootstrapProgress,
  markBootstrapProgressTask,
  resolveLlmConfig,
  runKnowledgeBuild,
  summarizeDelegateGroups,
  type KnowledgeBuildProgressEvent,
  type KnowledgeBuildReport,
  type LlmClient,
  type LlmOverrides,
  type ResolvedLlmConfig,
} from '@kmind/core';
import {
  DigTaskStatusEnum,
  KMindError,
} from '@kmind/shared';
import type { AppContext } from '../context.js';
import { fail, success } from '../exit.js';
import { ensureBootstrapRulesYaml } from './init.js';
import { llmOverridesFromFlags } from './llm.js';
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
 * One-shot idempotent knowledge-init:
 * ensure vault files → reindex → plan → (opt-in LLM dig + capture) → FEATURE_TREE → coverage.
 * ADR-004 by default (plan only); ADR-005 when `--write` / `--dry-run` is passed.
 */
export interface BootstrapRunOptions {
  project: string;
  repo?: string;
  /** Write bootstrap dig rows into FEATURE_TREE (default true). */
  tree?: boolean;
  /** Rebuild sqlite index before planning (default true). */
  reindex?: boolean;
  /** Topic filter for the coverage summary. */
  topic?: string;
  /** ADR-005: LLM dig + capture knowledge bodies (opt-in). */
  write?: boolean;
  /** Dig + quality check without writing or marking progress. */
  dryRun?: boolean;
  /** Only this DigGroup label. */
  group?: string;
  /** Cap tasks for this run. */
  maxTasks?: number;
  /** Cards requested per task. */
  maxCardsPerTask?: number;
  /** Skip cards below this confidence (0-1). */
  minConfidence?: number;
  /** Disable the one-shot LLM repair attempt. */
  repair?: boolean;
  /** Provider/model overrides (also persisted alternatives via `kmind llm set`). */
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}

export async function cmdBootstrapRun(
  ctx: AppContext,
  options: BootstrapRunOptions,
): Promise<void> {
  const project = requireProject(options.project, ctx.json);
  const repoRoot = resolveBootstrapRepo(ctx, options.repo);
  const llmOverrides = llmOverridesFrom(options);
  const dryRun = options.dryRun === true;
  const wantsWrite = options.write === true || dryRun;
  const maxTasks = intOption(options.maxTasks, '--max-tasks', 0, 10_000);
  const maxCards = intOption(options.maxCardsPerTask, '--max-cards', 1, 4);
  const minConfidence = numberOption(
    options.minConfidence,
    '--min-confidence',
    0,
    1,
  );

  // ADR-005: resolve the LLM before any side effect so misconfig fails fast.
  const buildRuntime = wantsWrite
    ? await resolveBuildRuntime(ctx, llmOverrides)
    : null;

  // 1) Idempotent vault files (team content is kept, never overwritten).
  const featureTree = await ensureProjectFeatureTree(ctx.vault.root);
  const bootstrapRules = await ensureBootstrapRulesYaml(ctx.vault.root);

  // 2) Rebuild the index so plan dedupe sees the latest markdown assets.
  let assetCount: number | null = null;
  if (options.reindex !== false) {
    await ctx.store.rebuildFromMarkdown(ctx.vault.knowledgeDir);
    assetCount = await ctx.store.countAssets();
  }

  // 3) Deterministic dig plan (optionally LLM-grouped with the same provider).
  let plan = await buildBootstrapPlanForVault(ctx.vault, ctx.store, {
    project,
    repoRoot,
    llmOverrides,
  });

  // 4) ADR-005 opt-in: LLM dig → quality gate → capture knowledge bodies.
  let build: KnowledgeBuildReport | null = null;
  if (buildRuntime) {
    if (!ctx.json) {
      process.stdout.write(
        `[kmind] llm provider=${buildRuntime.resolved.provider} model=${buildRuntime.resolved.model}` +
          (dryRun ? ' (dry-run: 不写盘)' : '') +
          '\n',
      );
    }
    build = await runKnowledgeBuild(
      {
        vault: ctx.vault,
        store: ctx.store,
        registry: ctx.registry,
        evolver: ctx.evolver,
        assetTypes: ctx.assetTypes,
      },
      {
        project,
        repoRoot,
        plan,
        llm: buildRuntime.llm,
        llmConfig: buildRuntime.resolved,
        ...(options.group?.trim() ? { group: options.group.trim() } : {}),
        ...(maxTasks === undefined ? {} : { maxTasks }),
        ...(maxCards === undefined ? {} : { maxCardsPerTask: maxCards }),
        ...(minConfidence === undefined ? {} : { minConfidence }),
        dryRun,
        repair: options.repair !== false,
        onProgress: (event) => reportBuildEvent(ctx.json, event),
      },
    );
    // Progress marks tasks done; rebuild so FEATURE_TREE reflects it.
    if (!dryRun && build.stats.cardsCaptured > 0) {
      plan = await buildBootstrapPlanForVault(ctx.vault, ctx.store, {
        project,
        repoRoot,
        llmOverrides,
      });
    }
  }

  // 5) Upsert bootstrap rows into FEATURE_TREE (idempotent on task id).
  let treeWrite: {
    path: string;
    action: string;
    rowsWritten: number;
  } | null = null;
  if (options.tree !== false && !dryRun) {
    const treeFile = featureTreePath(ctx.vault.root);
    const existing = await fs.readFile(treeFile, 'utf8');
    const applied = applyBootstrapPlanToFeatureTree(existing, plan);
    if (applied.action !== 'unchanged') {
      await fs.writeFile(treeFile, applied.next, 'utf8');
    }
    treeWrite = {
      path: treeFile,
      action: applied.action,
      rowsWritten: applied.rowsWritten,
    };
  }

  // 6) Coverage receipt: bootstrap output alone never claims complete.
  const coverage = await assessCoverageWithProtocol(ctx.vault, ctx.store, {
    project,
    topic: options.topic,
  });

  const tasks = plan.groups.flatMap((g) => g.tasks);
  const todo = tasks.filter((t) => t.status !== 'done').length;
  const groupCommands = plan.groups.map((g) => ({
    group: g.label,
    priority: g.priority,
    todo: g.tasks.filter((t) => t.status !== 'done').length,
    command: `kmind bootstrap delegate --project ${project} --group "${g.label}"`,
  }));
  const nextCommands = [
    ...(wantsWrite
      ? [
          {
            group: 'coverage',
            priority: 0,
            todo,
            command: `kmind coverage --project ${project}`,
          },
          ...(todo > 0
            ? [
                {
                  group: 'build',
                  priority: 0,
                  todo,
                  command:
                    `kmind bootstrap run --project ${project} --write` +
                    ` --max-tasks ${Math.min(todo, 5)}`,
                },
              ]
            : []),
        ]
      : []),
    ...groupCommands.filter((row) => row.todo > 0),
  ];

  const note = wantsWrite
    ? 'ADR-005: LLM 生成的卡片已逐张通过 capture 质量闸门；低置信/失败卡片被跳过并在 build 报告中列出。仍需 kmind coverage 验证 complete=true。'
    : 'Bootstrap 默认不写知识正文（ADR-004）。要端到端写入，运行 kmind bootstrap run --write。';

  const payload = {
    ok: true,
    project,
    repoRoot,
    vault: { featureTree, bootstrapRules },
    reindex:
      assetCount === null
        ? { skipped: true }
        : { reindexed: true, assetCount },
    plan: { ...plan.stats, todo },
    build,
    tree: treeWrite,
    coverage: {
      summary: coverage.summary,
      claimCompleteAllowed: coverage.claimCompleteAllowed,
      recentRecall: coverage.recentRecall.status,
      quality: coverage.quality,
      issues: coverage.issues,
      nextActions: coverage.nextActions,
    },
    nextCommands,
    note,
  };

  if (ctx.json) {
    success(payload, true);
    return;
  }

  process.stdout.write(
    `[kmind] bootstrap run project=${project} repo=${repoRoot}\n`,
  );
  process.stdout.write(
    `[kmind] vault: featureTree=${featureTree.action} bootstrapRules=${bootstrapRules.action}` +
      (assetCount === null ? ' reindex=skipped' : ` reindex=${assetCount} assets`) +
      '\n',
  );
  process.stdout.write(
    `[kmind] plan: groups=${plan.stats.groupCount} tasks=${plan.stats.taskCount} todo=${todo} done=${plan.stats.tasksAlreadyDone} selected=${plan.stats.modulesSelected} excluded=${plan.stats.modulesExcluded}\n`,
  );
  if (build) {
    process.stdout.write(
      `[kmind] build: tasks=${build.stats.tasksConsidered} captured=${build.stats.tasksCaptured} failed=${build.stats.tasksFailed} cards+ ${build.stats.cardsCaptured} rejected=${build.stats.cardsRejected} ${Math.round(build.durationMs / 1000)}s\n`,
    );
    if (build.hub) {
      process.stdout.write(
        `[kmind] hub: ${build.hub.created ? 'created' : 'exists'} ${build.hub.title ?? ''}` +
          (build.hub.id ? ` (${build.hub.id})` : '') +
          '\n',
      );
    }
    if (build.assetIds.length) {
      process.stdout.write(
        `[kmind] assets(${build.assetIds.length}): ${build.assetIds.slice(0, 12).join(', ')}` +
          (build.assetIds.length > 12 ? ' …' : '') +
          '\n',
      );
    }
    const rejected = build.tasks
      .flatMap((task) => task.cards.map((card) => ({ task, card })))
      .filter(
        (row) =>
          row.card.status === 'quality_rejected' || row.card.status === 'failed',
      )
      .slice(0, 8);
    for (const row of rejected) {
      process.stdout.write(
        `[kmind]   skip [${row.card.type}] ${row.card.title} — ${row.card.reasons?.[0] ?? row.card.status}\n`,
      );
    }
  }
  if (treeWrite) {
    process.stdout.write(
      `[kmind] FEATURE_TREE ${treeWrite.action} → ${treeWrite.path} (rows=${treeWrite.rowsWritten})\n`,
    );
  }
  process.stdout.write(
    `[kmind] coverage: complete=${coverage.claimCompleteAllowed} ${coverage.summary}\n`,
  );
  if (coverage.issues.length) {
    process.stdout.write(`[kmind] issues=${coverage.issues.length}\n`);
  }
  process.stdout.write('\n[kmind] next:\n');
  for (const row of nextCommands.slice(0, 12)) {
    process.stdout.write(`  ${row.command}\n`);
  }
  if (nextCommands.length > 12) {
    process.stdout.write(
      `  … ${nextCommands.length - 12} more — use --json to list all\n`,
    );
  }
  process.stdout.write(`\n[kmind] ${note}\n`);
}

/**
 * Map provider/model flags to LLM overrides (validated, key stays in env).
 */
function llmOverridesFrom(options: BootstrapRunOptions): LlmOverrides {
  return llmOverridesFromFlags({
    provider: options.provider,
    model: options.model,
    baseUrl: options.baseUrl,
    apiKeyEnv: options.apiKeyEnv,
  });
}

function intOption(
  value: number | undefined,
  flag: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new KMindError(`${flag} 须为 ${min}–${max} 的整数`, {
      category: 'CONFIG_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: `当前值：${String(value)}`,
    });
  }
  return value;
}

function numberOption(
  value: number | undefined,
  flag: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new KMindError(`${flag} 须在 ${min}–${max} 之间`, {
      category: 'CONFIG_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: `当前值：${String(value)}`,
    });
  }
  return value;
}

async function resolveBuildRuntime(
  ctx: AppContext,
  llmOverrides: LlmOverrides,
): Promise<{ resolved: ResolvedLlmConfig; llm: LlmClient }> {
  const config = await ctx.vault.getConfig();
  const resolved = resolveLlmConfig(config, llmOverrides);
  return { resolved, llm: createLlmClient(resolved) };
}

function reportBuildEvent(json: boolean, event: KnowledgeBuildProgressEvent): void {
  if (json) return;
  switch (event.type) {
    case 'task_start':
      process.stdout.write(
        `[kmind] dig ${event.index}/${event.total} ${event.taskId} (${event.paths.join(', ')})\n`,
      );
      break;
    case 'task_done':
      process.stdout.write(
        `[kmind]   → ${event.status} captured=${event.cardsCaptured} rejected=${event.cardsRejected}` +
          (event.error ? ` (${event.error})` : '') +
          '\n',
      );
      break;
    case 'card':
      process.stdout.write(
        `[kmind]   · [${event.cardType}] ${event.title} → ${event.status}` +
          (event.assetId ? ` ${event.assetId}` : '') +
          (event.reasons?.length ? ` (${event.reasons[0]})` : '') +
          '\n',
      );
      break;
    case 'hub':
      process.stdout.write(
        `[kmind] hub ${event.created ? 'created' : 'exists'} ${event.title ?? ''}` +
          (event.id ? ` ${event.id}` : '') +
          '\n',
      );
      break;
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
