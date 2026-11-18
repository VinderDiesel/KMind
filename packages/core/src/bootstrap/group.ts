import type {
  BootstrapModule,
  BootstrapRuleEntry,
  DigGroup,
  DigTask,
  DigTaskSuggestedAnchor,
} from '@kmind/shared';
import { matchCandidateType } from './rules.js';
import {
  modulesFromLlmGroups,
  type BootstrapLlmClient,
  type ModuleGroupMeta,
} from './llm.js';

/** Soft cap inspired by OCR maxFilesPerGroup — keep agent context focused. */
export const MAX_TASKS_PER_GROUP = 8;

export interface ExistingAssetHint {
  id: string;
  title: string;
  /** Relative paths from code anchors or known modules. */
  paths?: string[];
}

export interface GroupModulesOptions {
  existing?: ExistingAssetHint[];
  overlayRules?: BootstrapRuleEntry[];
  /** Precomputed anchors by module path. */
  anchorsByPath?: Map<string, DigTaskSuggestedAnchor[]>;
  llm?: BootstrapLlmClient;
  llmGrouping?: boolean;
}

/**
 * Group selected modules into DigGroups with candidate DigTasks.
 */
export async function groupModules(
  selected: BootstrapModule[],
  options: GroupModulesOptions = {},
): Promise<{ groups: DigGroup[]; tasksAlreadyDone: number }> {
  const existing = options.existing ?? [];
  const overlay = options.overlayRules ?? [];
  const anchorsByPath = options.anchorsByPath;

  let byBucket: Map<string, BootstrapModule[]> | null = null;
  if (options.llmGrouping && options.llm && selected.length > 1) {
    const meta: ModuleGroupMeta[] = selected.map((m, index) => ({
      index,
      path: m.path,
      fileCount: m.fileCount ?? 1,
    }));
    const llmGroups = await options.llm.groupModules(meta).catch(() => null);
    if (llmGroups) {
      byBucket = modulesFromLlmGroups(selected, llmGroups);
    }
  }
  if (!byBucket) {
    byBucket = new Map<string, BootstrapModule[]>();
    for (const mod of selected) {
      const label = groupLabel(mod.path);
      const list = byBucket.get(label) ?? [];
      list.push(mod);
      byBucket.set(label, list);
    }
  }

  let tasksAlreadyDone = 0;
  const groups: DigGroup[] = [];

  for (const [label, mods] of [...byBucket.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const tasks: DigTask[] = [];
    for (const mod of mods) {
      const match = matchCandidateType(mod.path, overlay);
      if (match.exclude) continue;
      const done = findDoneAsset(mod.path, match.titleHint, existing);
      const suggestedAnchors =
        anchorsByPath?.get(mod.path) ?? suggestAnchors(mod.path);
      const task: DigTask = {
        id: digTaskId(mod.path),
        titleHint: match.titleHint,
        candidateType: match.candidateType,
        paths: [mod.path],
        suggestedAnchors,
        status: done ? 'done' : 'todo',
        notes: match.notes,
        assetId: done?.id,
      };
      if (done) tasksAlreadyDone += 1;
      tasks.push(task);
    }
    if (tasks.length === 0) continue;

    const chunks = chunkTasks(tasks, MAX_TASKS_PER_GROUP);
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      const chunkLabel =
        chunks.length === 1 ? label : `${label} (${i + 1}/${chunks.length})`;
      const priority = chunk.reduce(
        (sum, t) =>
          sum + (mods.find((m) => m.path === t.paths[0])?.fileCount ?? 1),
        0,
      );
      groups.push({
        label: chunkLabel,
        tasks: chunk,
        priority,
      });
    }
  }

  groups.sort(
    (a, b) => b.priority - a.priority || a.label.localeCompare(b.label),
  );
  return { groups, tasksAlreadyDone };
}

/**
 * Bucket key: packages/<name> or top-level segment.
 */
export function groupLabel(modulePath: string): string {
  const parts = modulePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts[0] === 'packages' && parts[1]) {
    return `packages/${parts[1]}`;
  }
  if (parts[0] === 'apps' && parts[1]) {
    return `apps/${parts[1]}`;
  }
  if (parts[0] === 'services' && parts[1]) {
    return `services/${parts[1]}`;
  }
  if (parts[0] === 'internal' && parts[1]) {
    return `internal/${parts[1]}`;
  }
  if (parts[0] === 'cmd' && parts[1]) {
    return `cmd/${parts[1]}`;
  }
  if (parts[0] === 'src') {
    return 'src';
  }
  if (modulePath === '.' || parts.length === 0) {
    return 'root';
  }
  return parts[0]!;
}

export function digTaskId(modulePath: string): string {
  const slug = modulePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `dig-${slug || 'root'}`;
}

function suggestAnchors(modulePath: string): DigTask['suggestedAnchors'] {
  const p = modulePath.replace(/\\/g, '/');
  if (p === '.') return [];
  return [{ file: `${p}/index.ts` }];
}

function findDoneAsset(
  modulePath: string,
  titleHint: string,
  existing: ExistingAssetHint[],
): ExistingAssetHint | undefined {
  const norm = modulePath.replace(/\\/g, '/').toLowerCase();
  const titleLower = titleHint.toLowerCase();
  for (const asset of existing) {
    if (
      asset.paths?.some(
        (ap) =>
          ap.replace(/\\/g, '/').toLowerCase().includes(norm) ||
          norm.includes(ap.replace(/\\/g, '/').toLowerCase()),
      )
    ) {
      return asset;
    }
    if (
      asset.title.toLowerCase().includes(titleLower) ||
      titleLower.includes(asset.title.toLowerCase())
    ) {
      return asset;
    }
  }
  return undefined;
}

function chunkTasks(tasks: DigTask[], size: number): DigTask[][] {
  if (tasks.length <= size) return [tasks];
  const out: DigTask[][] = [];
  for (let i = 0; i < tasks.length; i += size) {
    out.push(tasks.slice(i, i + size));
  }
  return out;
}
