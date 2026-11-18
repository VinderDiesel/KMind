import { describe, expect, it } from 'vitest';
import type { BootstrapPlan } from '@kmind/shared';
import { findDigTask, lookupDigTaskCandidateType } from './lookup-task.js';

const plan: BootstrapPlan = {
  version: '1',
  project: 'demo',
  repoRoot: '/tmp/demo',
  groups: [
    {
      label: 'core',
      priority: 10,
      tasks: [
        {
          id: 'dig-packages-core-src',
          titleHint: 'core src',
          candidateType: 'architecture_design',
          paths: ['packages/core/src'],
          suggestedAnchors: [],
          status: 'todo',
        },
      ],
    },
  ],
  excluded: [],
  stats: {
    modulesScanned: 1,
    modulesSelected: 1,
    modulesExcluded: 0,
    groupCount: 1,
    taskCount: 1,
    tasksAlreadyDone: 0,
  },
  generatedAt: new Date().toISOString(),
};

describe('lookupDigTaskCandidateType', () => {
  it('given known task id when lookup then returns candidateType', () => {
    expect(lookupDigTaskCandidateType(plan, 'dig-packages-core-src')).toBe(
      'architecture_design',
    );
    expect(findDigTask(plan, 'dig-packages-core-src')?.titleHint).toBe(
      'core src',
    );
  });

  it('given unknown task id when lookup then undefined', () => {
    expect(lookupDigTaskCandidateType(plan, 'missing')).toBeUndefined();
  });
});
