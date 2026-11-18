import { describe, expect, it } from 'vitest';
import type { BootstrapPlan } from '@kmind/shared';
import {
  buildDigPacket,
  pickRecommendedNextGroup,
  summarizeDelegateGroups,
} from './delegate.js';

function fakePlan(overrides?: Partial<BootstrapPlan>): BootstrapPlan {
  return {
    version: '1',
    project: 'demo',
    repoRoot: '/repo',
    excluded: [],
    generatedAt: '2026-11-18T00:00:00.000Z',
    stats: {
      modulesScanned: 2,
      modulesSelected: 2,
      modulesExcluded: 0,
      groupCount: 2,
      taskCount: 2,
      tasksAlreadyDone: 0,
    },
    groups: [
      {
        label: 'packages/shared',
        priority: 10,
        tasks: [
          {
            id: 'dig-shared',
            titleHint: 'shared',
            candidateType: 'best_practice',
            paths: ['packages/shared'],
            suggestedAnchors: [],
            status: 'todo',
          },
        ],
      },
      {
        label: 'packages/core',
        priority: 50,
        tasks: [
          {
            id: 'dig-core',
            titleHint: 'core',
            candidateType: 'architecture_design',
            paths: ['packages/core'],
            suggestedAnchors: [],
            status: 'todo',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('summarizeDelegateGroups', () => {
  it('given two groups with todos when summarize then recommendedNext is higher priority', () => {
    const summary = summarizeDelegateGroups(fakePlan());
    expect(summary.recommendedNext).toBe('packages/core');
    expect(summary.stats.tasksOpen).toBeGreaterThan(0);
    expect(pickRecommendedNextGroup(fakePlan())).toBe('packages/core');
  });

  it('given all done when buildDigPacket skipDone then tasks empty and acceptance still forbids complete', () => {
    const plan = fakePlan({
      groups: [
        {
          label: 'g',
          priority: 1,
          tasks: [
            {
              id: 'dig-done',
              titleHint: 'done',
              candidateType: 'best_practice',
              paths: ['x'],
              suggestedAnchors: [],
              status: 'done',
              assetId: 'k-2026-11-18-001-abcd',
            },
          ],
        },
      ],
      stats: {
        modulesScanned: 1,
        modulesSelected: 1,
        modulesExcluded: 0,
        groupCount: 1,
        taskCount: 1,
        tasksAlreadyDone: 1,
      },
    });
    const packet = buildDigPacket({
      plan,
      groupLabel: 'g',
      skipDone: true,
    });
    expect(packet.tasks).toEqual([]);
    expect(packet.acceptance.completeClaimForbiddenUntil).toMatch(
      /complete=true/,
    );
  });
});
