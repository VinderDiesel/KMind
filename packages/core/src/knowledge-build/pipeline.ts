import type {
  BootstrapPlan,
  DigTask,
  GeneratedKnowledgeCard,
} from '@kmind/shared';
import { KMindError } from '@kmind/shared';
import type { AssetTypeRegistry } from '../asset-types/registry.js';
import { hashBootstrapPlan, markBootstrapProgressTask } from '../bootstrap/index.js';
import { isOverviewTitle } from '../compiler/capture-quality.js';
import type { LlmClient, ResolvedLlmConfig } from '../llm/types.js';
import type { OntologyEvolver } from '../ontology/ontology-evolver.js';
import type { OntologyRegistry } from '../ontology/ontology-registry.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import type { Vault } from '../storage/vault.js';
import {
  assessKnowledgeCardQuality,
  captureKnowledgeCard,
  type KnowledgeCardCaptureDeps,
  type KnowledgeCardCaptureInput,
} from './capture.js';
import { digModuleWithLlm, repairCardWithLlm } from './digger.js';
import type { PromptTypeOption } from './prompts.js';
import { collectModuleEvidence, type ModuleEvidence } from './scanner.js';

export interface KnowledgeBuildDeps extends KnowledgeCardCaptureDeps {
  vault: Vault;
  store: SqliteStore;
  registry: OntologyRegistry;
  evolver?: OntologyEvolver;
  assetTypes: AssetTypeRegistry;
}

export interface KnowledgeBuildOptions {
  project: string;
  repoRoot: string;
  plan: BootstrapPlan;
  llm: LlmClient;
  llmConfig: Pick<ResolvedLlmConfig, 'maxInputChars'>;
  /** Only dig this DigGroup label (exact match). */
  group?: string;
  /** Cap tasks for this run (all when omitted). */
  maxTasks?: number;
  /** Cards requested per task (default 2, max 4). */
  maxCardsPerTask?: number;
  /** Cards below this confidence are skipped (default 0.55). */
  minConfidence?: number;
  /** Dig + quality check only; never writes or marks progress. */
  dryRun?: boolean;
  /** Include tasks already marked done. */
  force?: boolean;
  /** One LLM repair attempt when the quality gate rejects a card. */
  repair?: boolean;
  onProgress?: (event: KnowledgeBuildProgressEvent) => void;
}

export type KnowledgeBuildProgressEvent =
  | {
      type: 'task_start';
      taskId: string;
      groupLabel: string;
      paths: string[];
      index: number;
      total: number;
    }
  | {
      type: 'task_done';
      taskId: string;
      status: KnowledgeBuildTaskReport['status'];
      cardsCaptured: number;
      cardsRejected: number;
      error?: string;
    }
  | {
      type: 'card';
      taskId: string;
      title: string;
      cardType: string;
      status: KnowledgeBuildCardReport['status'];
      assetId?: string;
      reasons?: string[];
    }
  | { type: 'hub'; id?: string; title?: string; created: boolean };

export interface KnowledgeBuildCardReport {
  title: string;
  type: string;
  confidence: number;
  status: 'captured' | 'dry_run' | 'skipped' | 'quality_rejected' | 'failed';
  assetId?: string;
  reasons?: string[];
}

export interface KnowledgeBuildTaskReport {
  taskId: string;
  groupLabel: string;
  paths: string[];
  status:
    | 'captured'
    | 'dry_run'
    | 'no_cards'
    | 'skipped'
    | 'failed';
  cards: KnowledgeBuildCardReport[];
  error?: string;
}

export interface KnowledgeBuildReport {
  project: string;
  repoRoot: string;
  provider: string;
  model: string;
  dryRun: boolean;
  tasks: KnowledgeBuildTaskReport[];
  stats: {
    tasksConsidered: number;
    tasksCaptured: number;
    tasksSkipped: number;
    tasksFailed: number;
    cardsCaptured: number;
    cardsRejected: number;
  };
  hub: { id?: string; title?: string; created: boolean } | null;
  assetIds: string[];
  durationMs: number;
}

/**
 * Evidence-grounded LLM build: DigTask → cards → quality gate → capture.
 * ADR-005: only runs from the explicit `bootstrap run --write` command.
 */
export async function runKnowledgeBuild(
  deps: KnowledgeBuildDeps,
  options: KnowledgeBuildOptions,
): Promise<KnowledgeBuildReport> {
  const started = Date.now();
  const project = options.project.trim();
  const dryRun = options.dryRun === true;
  const repair = options.repair !== false;
  const maxCards = clamp(options.maxCardsPerTask ?? 2, 1, 4);
  const minConfidence = options.minConfidence ?? 0.55;
  const planHash = hashBootstrapPlan(options.plan);
  const typeOptions = enabledTypeOptions(deps.assetTypes);
  const enabledTypes = new Set(typeOptions.map((option) => option.id));

  const existing = await deps.store.queryAssets({ project, limit: 100_000 });
  const knownTitles = new Set(existing.map((asset) => normalizeTitle(asset.title)));
  const titleHints = existing.map((asset) => asset.title);
  const existingHub = existing.find((asset) => isOverviewTitle(asset.title));
  let relatedAnchorId: string | undefined =
    existingHub?.id ??
    existing.find((asset) => !isOverviewTitle(asset.title))?.id;

  const entries = options.plan.groups
    .flatMap((group) => group.tasks.map((task) => ({ group, task })))
    .filter(({ group }) => !options.group || group.label === options.group)
    .filter(({ task }) => options.force || task.status !== 'done');
  const limited =
    typeof options.maxTasks === 'number'
      ? entries.slice(0, Math.max(0, options.maxTasks))
      : entries;

  const taskReports: KnowledgeBuildTaskReport[] = [];
  const assetIds: string[] = [];
  let cardsCaptured = 0;
  let cardsRejected = 0;

  for (const [index, entry] of limited.entries()) {
    const { group, task } = entry;
    options.onProgress?.({
      type: 'task_start',
      taskId: task.id,
      groupLabel: group.label,
      paths: task.paths,
      index: index + 1,
      total: limited.length,
    });

    const taskReport = await buildOneTask({
      deps,
      options,
      task,
      groupLabel: group.label,
      typeOptions,
      enabledTypes,
      knownTitles,
      titleHints,
      maxCards,
      minConfidence,
      repair,
      dryRun,
      getRelatedAnchorId: () => relatedAnchorId,
      onCaptured: (assetId, title) => {
        if (assetId) assetIds.push(assetId);
        cardsCaptured += 1;
        knownTitles.add(normalizeTitle(title));
        if (!relatedAnchorId && assetId) relatedAnchorId = assetId;
      },
      onRejected: () => {
        cardsRejected += 1;
      },
    });
    taskReports.push(taskReport);

    if (taskReport.status === 'captured' && !dryRun) {
      const firstAsset = taskReport.cards.find((card) => card.assetId)?.assetId;
      try {
        await markBootstrapProgressTask({
          vault: deps.vault,
          project,
          repoRoot: options.repoRoot,
          taskId: task.id,
          status: 'done',
          ...(firstAsset ? { assetId: firstAsset } : {}),
          planHash,
        });
      } catch {
        /* progress is best-effort; capture result stands */
      }
    }

    options.onProgress?.({
      type: 'task_done',
      taskId: task.id,
      status: taskReport.status,
      cardsCaptured: taskReport.cards.filter((c) => c.status === 'captured')
        .length,
      cardsRejected: taskReport.cards.filter(
        (c) => c.status === 'quality_rejected',
      ).length,
      ...(taskReport.error ? { error: taskReport.error } : {}),
    });
  }

  let hub: KnowledgeBuildReport['hub'] = null;
  if (!dryRun && cardsCaptured > 0) {
    hub = await ensureProjectHub(deps, {
      project,
      onProgress: options.onProgress,
    });
  }

  return {
    project,
    repoRoot: options.repoRoot,
    provider: options.llm.provider,
    model: options.llm.model,
    dryRun,
    tasks: taskReports,
    stats: {
      tasksConsidered: limited.length,
      tasksCaptured: taskReports.filter((t) => t.status === 'captured').length,
      tasksSkipped: taskReports.filter((t) => t.status === 'skipped').length,
      tasksFailed: taskReports.filter((t) => t.status === 'failed').length,
      cardsCaptured,
      cardsRejected,
    },
    hub,
    assetIds,
    durationMs: Date.now() - started,
  };
}

interface BuildOneTaskArgs {
  deps: KnowledgeBuildDeps;
  options: KnowledgeBuildOptions;
  task: DigTask;
  groupLabel: string;
  typeOptions: PromptTypeOption[];
  enabledTypes: Set<string>;
  knownTitles: Set<string>;
  titleHints: string[];
  maxCards: number;
  minConfidence: number;
  repair: boolean;
  dryRun: boolean;
  /** Read at capture time so later cards in the same task attach to earlier ones. */
  getRelatedAnchorId: () => string | undefined;
  onCaptured: (assetId: string, title: string) => void;
  onRejected: () => void;
}

async function buildOneTask(
  args: BuildOneTaskArgs,
): Promise<KnowledgeBuildTaskReport> {
  const { options, task } = args;
  const report: KnowledgeBuildTaskReport = {
    taskId: task.id,
    groupLabel: args.groupLabel,
    paths: task.paths,
    status: 'failed',
    cards: [],
  };

  let evidence: ModuleEvidence;
  try {
    evidence = await collectModuleEvidence({
      repoRoot: options.repoRoot,
      paths: task.paths,
      maxChars: options.llmConfig.maxInputChars,
    });
  } catch (err) {
    report.error = `scan_failed: ${errorMessage(err)}`;
    return report;
  }
  if (evidence.files.length === 0) {
    report.status = 'skipped';
    report.error = 'no_evidence_files';
    return report;
  }

  let cards: GeneratedKnowledgeCard[];
  try {
    const dig = await digModuleWithLlm(options.llm, {
      project: options.project,
      task,
      evidence,
      existingTitles: args.titleHints,
      maxCards: args.maxCards,
      typeOptions: args.typeOptions,
    });
    cards = dig.cards;
    if (cards.length === 0) {
      report.status = 'no_cards';
      report.error = dig.errors.slice(0, 3).join('; ') || 'llm_returned_no_cards';
      return report;
    }
  } catch (err) {
    if (isFatalLlmError(err)) throw err;
    report.status = 'failed';
    report.error = `llm_failed: ${errorMessage(err)}`;
    return report;
  }

  for (const card of cards) {
    const cardReport: KnowledgeBuildCardReport = {
      title: card.title,
      type: card.type,
      confidence: card.confidence,
      status: 'skipped',
    };
    report.cards.push(cardReport);

    if (!args.enabledTypes.has(card.type)) {
      cardReport.reasons = [`type_not_enabled: ${card.type}`];
      options.onProgress?.({
        type: 'card',
        taskId: task.id,
        title: card.title,
        cardType: card.type,
        status: cardReport.status,
        reasons: cardReport.reasons,
      });
      continue;
    }
    if (card.confidence < args.minConfidence) {
      cardReport.reasons = [
        `low_confidence: ${card.confidence.toFixed(2)} < ${args.minConfidence}`,
      ];
      options.onProgress?.({
        type: 'card',
        taskId: task.id,
        title: card.title,
        cardType: card.type,
        status: cardReport.status,
        reasons: cardReport.reasons,
      });
      continue;
    }
    if (args.knownTitles.has(normalizeTitle(card.title))) {
      cardReport.reasons = ['duplicate_title'];
      options.onProgress?.({
        type: 'card',
        taskId: task.id,
        title: card.title,
        cardType: card.type,
        status: cardReport.status,
        reasons: cardReport.reasons,
      });
      continue;
    }

    const relatedAnchorId = args.getRelatedAnchorId();
    const input: KnowledgeCardCaptureInput = {
      project: options.project,
      title: card.title,
      type: card.type,
      content: card.content,
      anchors: card.anchors,
      ...(relatedAnchorId ? { related: [relatedAnchorId] } : {}),
    };

    let current = card;
    let quality = await safeQuality(args.deps, input);
    if (!quality.ok && args.repair) {
      try {
        const repaired = await repairCardWithLlm(options.llm, {
          project: options.project,
          card,
          reasons: quality.reasons,
          evidence,
          candidateType: task.candidateType,
        });
        if (repaired && args.enabledTypes.has(repaired.type)) {
          current = repaired;
          cardReport.title = repaired.title;
          cardReport.type = repaired.type;
          input.title = repaired.title;
          input.type = repaired.type;
          input.content = repaired.content;
          input.anchors = repaired.anchors;
          quality = await safeQuality(args.deps, input);
        }
      } catch (err) {
        if (isFatalLlmError(err)) throw err;
        quality = {
          ...quality,
          reasons: [
            ...quality.reasons,
            `repair_failed: ${errorMessage(err)}`,
          ],
        };
      }
    }

    if (!quality.ok) {
      cardReport.status = 'quality_rejected';
      cardReport.reasons = quality.reasons.slice(0, 6);
      args.onRejected();
      options.onProgress?.({
        type: 'card',
        taskId: task.id,
        title: cardReport.title,
        cardType: cardReport.type,
        status: cardReport.status,
        reasons: cardReport.reasons,
      });
      continue;
    }

    if (args.dryRun) {
      cardReport.status = 'dry_run';
      options.onProgress?.({
        type: 'card',
        taskId: task.id,
        title: cardReport.title,
        cardType: cardReport.type,
        status: cardReport.status,
      });
      continue;
    }

    try {
      const captured = await captureKnowledgeCard(args.deps, input);
      if (!captured.ok) {
        cardReport.status = 'quality_rejected';
        cardReport.reasons = captured.quality.reasons.slice(0, 6);
        args.onRejected();
      } else {
        cardReport.status = 'captured';
        if (captured.assetId) cardReport.assetId = captured.assetId;
        args.onCaptured(
          captured.assetId ?? '',
          current.title,
        );
      }
    } catch (err) {
      cardReport.status = 'failed';
      cardReport.reasons = [errorMessage(err)];
    }
    options.onProgress?.({
      type: 'card',
      taskId: task.id,
      title: cardReport.title,
      cardType: cardReport.type,
      status: cardReport.status,
      ...(cardReport.assetId ? { assetId: cardReport.assetId } : {}),
      ...(cardReport.reasons ? { reasons: cardReport.reasons } : {}),
    });
  }

  if (report.cards.some((card) => card.status === 'captured')) {
    report.status = 'captured';
  } else if (report.cards.some((card) => card.status === 'dry_run')) {
    report.status = 'dry_run';
  } else if (report.cards.some((card) => card.status === 'quality_rejected')) {
    report.status = 'failed';
    report.error = 'all_cards_failed_quality_gate';
  } else {
    report.status = 'skipped';
  }
  return report;
}

async function safeQuality(
  deps: KnowledgeBuildDeps,
  input: KnowledgeCardCaptureInput,
) {
  try {
    return await assessKnowledgeCardQuality(deps, input);
  } catch (err) {
    return {
      ok: false,
      reasons: [errorMessage(err)],
      hints: [],
    };
  }
}

async function ensureProjectHub(
  deps: KnowledgeBuildDeps,
  options: {
    project: string;
    onProgress?: (event: KnowledgeBuildProgressEvent) => void;
  },
): Promise<KnowledgeBuildReport['hub']> {
  const assets = await deps.store.queryAssets({
    project: options.project,
    limit: 100_000,
  });
  const existingHub = assets.find((asset) => isOverviewTitle(asset.title));
  if (existingHub) {
    const result = {
      id: existingHub.id,
      title: existingHub.title,
      created: false,
    };
    options.onProgress?.({ type: 'hub', ...result });
    return result;
  }

  const details = assets.filter(
    (asset) => !isOverviewTitle(asset.title) && asset.status !== 'deprecated',
  );
  if (details.length === 0) return null;

  const title = `${options.project} 项目知识总览`;
  const body = buildHubBody(options.project, details);
  try {
    const captured = await captureKnowledgeCard(deps, {
      project: options.project,
      title,
      type: 'best_practice',
      content: body,
      related: details.map((asset) => asset.id),
    });
    if (!captured.ok) {
      const result = { title, created: false };
      options.onProgress?.({ type: 'hub', ...result });
      return result;
    }
    const result = {
      ...(captured.assetId ? { id: captured.assetId } : {}),
      title,
      created: true,
    };
    options.onProgress?.({ type: 'hub', ...result });
    return result;
  } catch {
    return { title, created: false };
  }
}

/**
 * Deterministic thin overview (no LLM): navigation + guardrails only.
 */
export function buildHubBody(
  project: string,
  details: Array<{ id: string; title: string; type: string }>,
): string {
  const rows = details.slice(0, 18).map((asset) => {
    const title = asset.title.length > 40
      ? `${asset.title.slice(0, 39)}…`
      : asset.title;
    return `- [${asset.type}] ${title}（${asset.id}）`;
  });
  const more =
    details.length > 18 ? `\n- … 其余 ${details.length - 18} 张明细卡见知识库` : '';
  return [
    '## 概览',
    '',
    `本总览由 \`kmind bootstrap run --write\` 自动生成，导航 project=${project} 的 ${details.length} 张明细卡。LLM 生成内容均已通过 capture 质量闸门；代码锚点是唯一事实来源。`,
    '',
    '## 模块索引',
    '',
    [...rows, more].filter(Boolean).join('\n'),
    '',
    '## 注意事项',
    '',
    '- 明细卡基于扫描时的代码证据生成；代码变更后请重跑命令，或对过时卡片执行 supersede。',
    '- 总览只做导航，不承载实现细节；新增主题请写明细卡并回填 related。',
    '- LLM 输出可能存在遗漏，使用前请以代码锚点复核。',
    '',
    '## 红线规避',
    '',
    '- 禁止仅凭本总览宣称「知识已完整」，以 `kmind coverage --project` 的 complete=true 为准。',
    '- 禁止把多个模块/组件塞进一张明细卡。',
  ].join('\n');
}

function enabledTypeOptions(registry: AssetTypeRegistry): PromptTypeOption[] {
  return registry.listEnabled().map((type) => ({
    id: type.id,
    guidance: type.guidance,
    scaffold: type.scaffold,
  }));
}

function isFatalLlmError(err: unknown): boolean {
  return (
    err instanceof KMindError &&
    err.category === 'ADAPTER_ERROR' &&
    !err.retryable
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
