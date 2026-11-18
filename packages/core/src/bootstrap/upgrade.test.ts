import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildBootstrapPlan,
  buildDigPacket,
  emptyBootstrapProgress,
  extractExportNames,
  hashBootstrapPlan,
  matchCandidateType,
  mergeProgressIntoPlan,
  modulesFromLlmGroups,
  summarizeDelegateGroups,
  upsertProgressTask,
} from './index.js';
import type { BootstrapLlmClient, LlmGroupResult } from './llm.js';
import type { BootstrapModule } from '@kmind/shared';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeRepo(layout: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-boot-up-'));
  tmpDirs.push(root);
  for (const [rel, body] of Object.entries(layout)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
  }
  return root;
}

describe('matchCandidateType overlay', () => {
  it('given overlay exclude when match then exclude true', () => {
    const m = matchCandidateType('packages/core/src/generated', [
      { pathGlob: '**/generated', exclude: true },
    ]);
    expect(m.exclude).toBe(true);
  });

  it('given overlay type when match then overrides builtin', () => {
    const m = matchCandidateType('packages/core/src/storage', [
      {
        pathGlob: '**/storage',
        candidateType: 'process_spec',
        titleHint: 'Storage ops',
      },
    ]);
    expect(m.candidateType).toBe('process_spec');
    expect(m.titleHint).toBe('Storage ops');
  });
});

describe('progress merge', () => {
  it('given progress done when merge then task done', async () => {
    const root = await makeRepo({
      'packages/core/src/storage/vault.ts': 'export function createVault() {}\n',
    });
    const plan = await buildBootstrapPlan({
      project: 'demo',
      repoRoot: root,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    const taskId = plan.groups[0]?.tasks[0]?.id;
    expect(taskId).toBeTruthy();
    let progress = emptyBootstrapProgress('demo', root, hashBootstrapPlan(plan));
    progress = upsertProgressTask(progress, taskId!, 'done', 'k-2026-11-18-001');
    const merged = mergeProgressIntoPlan(plan, progress);
    const task = merged.groups.flatMap((g) => g.tasks).find((t) => t.id === taskId);
    expect(task?.status).toBe('done');
    expect(task?.assetId).toBe('k-2026-11-18-001');
  });
});

describe('llm grouping fallback', () => {
  it('given fake llm groups when modulesFromLlmGroups then buckets', () => {
    const selected: BootstrapModule[] = [
      { path: 'a', kind: 'dir', reason: 'selected', fileCount: 1 },
      { path: 'b', kind: 'dir', reason: 'selected', fileCount: 1 },
    ];
    const groups: LlmGroupResult[] = [
      { label: 'g1', moduleIndexes: [0, 1] },
    ];
    const map = modulesFromLlmGroups(selected, groups);
    expect(map?.get('g1')?.length).toBe(2);
  });

  it('given llmGrouping when llm returns groups then plan uses labels', async () => {
    const root = await makeRepo({
      'packages/core/src/storage/vault.ts': 'export const a = 1;\n',
      'packages/core/src/compiler/p.ts': 'export const b = 2;\n',
    });
    const llm: BootstrapLlmClient = {
      async groupModules(meta) {
        return [{ label: 'llm-bundle', moduleIndexes: meta.map((m) => m.index) }];
      },
      async planGroup() {
        return 'watch for token budget';
      },
    };
    const plan = await buildBootstrapPlan({
      project: 'demo',
      repoRoot: root,
      llm,
      llmGrouping: true,
      llmPlan: true,
      planPriorityThreshold: 0,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    expect(plan.groups.some((g) => g.label.startsWith('llm-bundle'))).toBe(
      true,
    );
    expect(plan.groups.some((g) => Boolean(g.planNotes))).toBe(true);
  });
});

describe('delegate packet', () => {
  it('given plan when buildDigPacket then filters done and sets acceptance', async () => {
    const root = await makeRepo({
      'packages/core/src/storage/vault.ts': 'export function createVault() {}\n',
    });
    const plan = await buildBootstrapPlan({
      project: 'demo',
      repoRoot: root,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    const label = plan.groups[0]!.label;
    const packet = buildDigPacket({ plan, groupLabel: label, skipDone: true });
    expect(packet.project).toBe('demo');
    expect(packet.acceptance.completeClaimForbiddenUntil.length).toBeGreaterThan(
      10,
    );
    expect(summarizeDelegateGroups(plan).groups.length).toBe(plan.groups.length);
  });
});

describe('extractExportNames', () => {
  it('given exports when extract then returns names', () => {
    const names = extractExportNames(
      'export function foo() {}\nexport const bar = 1;\nexport { baz };\n',
    );
    expect(names).toContain('foo');
    expect(names).toContain('bar');
    expect(names).toContain('baz');
  });
});
