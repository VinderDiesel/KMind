import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyBootstrapPlanToFeatureTree,
  buildBootstrapPlan,
  groupLabel,
  matchCandidateType,
  selectModules,
} from './index.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeRepo(layout: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-bootstrap-'));
  tmpDirs.push(root);
  for (const [rel, body] of Object.entries(layout)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
  }
  return root;
}

describe('selectModules', () => {
  it('given packages with src when select then keeps modules and excludes node_modules', async () => {
    const root = await makeRepo({
      'packages/core/src/storage/vault.ts': 'export const x = 1;\n',
      'packages/core/src/compiler/pipeline.ts': 'export const y = 2;\n',
      'packages/core/node_modules/pkg/index.js': 'module.exports = {};\n',
      'packages/cli/src/commands/coverage.ts': 'export const z = 3;\n',
      'packages/cli/dist/index.js': 'ignored\n',
    });

    const { selected, excluded } = await selectModules({ repoRoot: root });

    expect(selected.some((m) => m.path.includes('src/storage'))).toBe(true);
    expect(selected.some((m) => m.path.includes('src/compiler'))).toBe(true);
    expect(selected.some((m) => m.path.includes('src/commands'))).toBe(true);
    expect(excluded.some((m) => m.path.includes('node_modules'))).toBe(true);
    expect(selected.every((m) => m.reason === 'selected')).toBe(true);
  });

  it('given oversized java main when select then splits by package', async () => {
    const root = await makeRepo({
      'src/main/java/com/acme/app/service/agent/AskAgentRouter.java':
        'class AskAgentRouter {}\n',
      'src/main/java/com/acme/app/service/query/AskQueryService.java':
        'class AskQueryService {}\n',
      'src/main/java/com/acme/app/metricgraph/MetricGraphBuilder.java':
        'class MetricGraphBuilder {}\n',
    });

    const { selected } = await selectModules({
      repoRoot: root,
      refineThreshold: 2,
    });
    const paths = selected.map((m) => m.path);

    expect(paths).toHaveLength(3);
    expect(paths.some((p) => p.endsWith('service/agent'))).toBe(true);
    expect(paths.some((p) => p.endsWith('service/query'))).toBe(true);
    expect(paths.some((p) => p.endsWith('metricgraph'))).toBe(true);
  });

  it('given small java main when select then keeps the module intact', async () => {
    const root = await makeRepo({
      'src/main/java/com/acme/app/service/AskService.java':
        'class AskService {}\n',
    });

    const { selected } = await selectModules({ repoRoot: root });

    expect(selected.map((m) => m.path)).toEqual(['src/main']);
  });
});

describe('matchCandidateType', () => {
  it('given cli commands path when match then tool_usage', () => {
    expect(matchCandidateType('packages/cli/src/commands').candidateType).toBe(
      'tool_usage',
    );
  });

  it('given storage path when match then architecture_design', () => {
    expect(
      matchCandidateType('packages/core/src/storage').candidateType,
    ).toBe('architecture_design');
  });
});

describe('groupLabel', () => {
  it('given packages path when label then packages/name', () => {
    expect(groupLabel('packages/core/src/storage')).toBe('packages/core');
  });

  it('given deep java src path when label then trailing functional segments', () => {
    expect(groupLabel('src/main/java/com/acme/app/service/agent')).toBe(
      'service/agent',
    );
    expect(groupLabel('src/main')).toBe('src/main');
  });
});

describe('buildBootstrapPlan', () => {
  it('given fixture repo when build then returns versioned plan without body text', async () => {
    const root = await makeRepo({
      'packages/core/src/storage/vault.ts': 'export function createVault() {}\n',
      'packages/cli/src/commands/search.ts': 'export function cmdSearch() {}\n',
    });

    const plan = await buildBootstrapPlan({
      project: 'demo',
      repoRoot: root,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });

    expect(plan.version).toBe('1');
    expect(plan.project).toBe('demo');
    expect(plan.stats.taskCount).toBeGreaterThan(0);
    expect(plan.groups.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toMatch(/## 实现方式/);
  });

  it('given global project when build then throws', async () => {
    await expect(
      buildBootstrapPlan({ project: 'global', repoRoot: os.tmpdir() }),
    ).rejects.toThrow(/non-global/);
  });

  it('given matching existing asset when build then marks task done', async () => {
    const root = await makeRepo({
      'packages/core/src/storage/vault.ts': 'export const a = 1;\n',
    });
    const plan = await buildBootstrapPlan({
      project: 'demo',
      repoRoot: root,
      existingAssets: [
        {
          id: 'k-2026-11-18-001',
          type: 'architecture_design',
          title: 'storage module design',
          project: 'demo',
          timestamp: '2026-11-18T00:00:00.000Z',
          status: 'published',
          confidence: 0.9,
          expiresAt: null,
          source: {
            terminal: 'manual',
            rawPath: 'manual/x.jsonl',
            capturedAt: '2026-11-18T00:00:00.000Z',
          },
          context: {
            problem: 'p',
            alternatives: [],
            decision: 'd',
            rationale: 'r',
            tradeOffs: [],
          },
          tags: [],
          related: [],
          links: [],
          body: 'body',
          ontologyClass: 'ArchitectureDesign',
          metadata: {
            codeAnchors: [{ file: 'packages/core/src/storage/vault.ts' }],
          },
        },
      ],
    });
    expect(plan.stats.tasksAlreadyDone).toBeGreaterThan(0);
    expect(
      plan.groups.some((g) => g.tasks.some((t) => t.status === 'done')),
    ).toBe(true);
  });
});

describe('applyBootstrapPlanToFeatureTree', () => {
  it('given empty tree when apply then creates marked section idempotently', async () => {
    const root = await makeRepo({
      'packages/core/src/storage/vault.ts': 'export const a = 1;\n',
    });
    const plan = await buildBootstrapPlan({
      project: 'demo',
      repoRoot: root,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });

    const first = applyBootstrapPlanToFeatureTree('# Feature tree\n', plan);
    expect(first.action).toBe('created_section');
    expect(first.next).toContain('kmind:bootstrap-dig-tasks:start');

    const second = applyBootstrapPlanToFeatureTree(first.next, plan);
    expect(second.action).toBe('unchanged');
  });
});
