import {
  BOOTSTRAP_PLAN_VERSION,
  BootstrapPlanSchema,
  type BootstrapPlan,
  type BootstrapProgress,
  type BootstrapRuleEntry,
  type KnowledgeAsset,
} from '@kmind/shared';
import { readCodeAnchors } from '../compiler/code-anchors.js';
import type { CodegraphClient } from '../codegraph/types.js';
import { enrichSuggestedAnchors } from './anchors.js';
import { groupModules, type ExistingAssetHint } from './group.js';
import type { BootstrapLlmClient } from './llm.js';
import { mergeProgressIntoPlan } from './progress.js';
import { matchCandidateType } from './rules.js';
import { selectModules } from './select.js';

export interface BuildBootstrapPlanOptions {
  project: string;
  repoRoot: string;
  /** Optional vault assets for done-dedupe (same project). */
  existingAssets?: KnowledgeAsset[];
  maxDepth?: number;
  now?: Date;
  overlayRules?: BootstrapRuleEntry[];
  progress?: BootstrapProgress | null;
  codegraph?: CodegraphClient;
  llm?: BootstrapLlmClient;
  llmGrouping?: boolean;
  llmPlan?: boolean;
  planPriorityThreshold?: number;
}

/**
 * Build a BootstrapPlan (ADR-004). Never writes knowledge bodies.
 */
export async function buildBootstrapPlan(
  options: BuildBootstrapPlanOptions,
): Promise<BootstrapPlan> {
  const project = options.project.trim();
  if (!project || project === 'global') {
    throw new Error('bootstrap: project must be a non-empty non-global name');
  }

  const overlay = options.overlayRules ?? [];
  const { selected: rawSelected, excluded: rawExcluded } = await selectModules({
    repoRoot: options.repoRoot,
    maxDepth: options.maxDepth,
  });

  const selected = [];
  const excluded = [...rawExcluded];
  for (const mod of rawSelected) {
    const match = matchCandidateType(mod.path, overlay);
    if (match.exclude) {
      excluded.push({
        path: mod.path,
        kind: mod.kind,
        reason: 'excluded',
        excludeReason: 'rule_overlay',
      });
      continue;
    }
    selected.push(mod);
  }

  const anchorsByPath = new Map();
  await Promise.all(
    selected.map(async (mod) => {
      const anchors = await enrichSuggestedAnchors(
        options.repoRoot,
        mod.path,
        options.codegraph,
      );
      anchorsByPath.set(mod.path, anchors);
    }),
  );

  const hints = toHints(options.existingAssets ?? []);
  let { groups, tasksAlreadyDone } = await groupModules(selected, {
    existing: hints,
    overlayRules: overlay,
    anchorsByPath,
    llm: options.llm,
    llmGrouping: options.llmGrouping,
  });

  const planThreshold = options.planPriorityThreshold ?? 40;
  if (options.llmPlan && options.llm) {
    groups = await Promise.all(
      groups.map(async (g) => {
        if (g.priority < planThreshold) return g;
        const notes = await options
          .llm!.planGroup(
            g.tasks.flatMap((t) => t.paths),
            g.priority,
          )
          .catch(() => null);
        if (!notes) return g;
        return { ...g, planNotes: notes };
      }),
    );
  }

  const taskCount = groups.reduce((n, g) => n + g.tasks.length, 0);
  let plan: BootstrapPlan = {
    version: BOOTSTRAP_PLAN_VERSION,
    project,
    repoRoot: options.repoRoot,
    groups,
    excluded,
    stats: {
      modulesScanned: selected.length + excluded.length,
      modulesSelected: selected.length,
      modulesExcluded: excluded.length,
      groupCount: groups.length,
      taskCount,
      tasksAlreadyDone,
    },
    generatedAt: (options.now ?? new Date()).toISOString(),
  };

  plan = mergeProgressIntoPlan(plan, options.progress ?? null);
  return BootstrapPlanSchema.parse(plan);
}

function toHints(assets: KnowledgeAsset[]): ExistingAssetHint[] {
  return assets.map((a) => ({
    id: a.id,
    title: a.title,
    paths: readCodeAnchors(a.metadata).map((an) => an.file),
  }));
}
