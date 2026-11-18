import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_PLAN_VERSION,
  BootstrapPlanSchema,
  DigTaskSchema,
} from './bootstrap.schema.js';

describe('BootstrapPlanSchema', () => {
  it('given valid plan when parse then accepts version 1', () => {
    const plan = BootstrapPlanSchema.parse({
      version: BOOTSTRAP_PLAN_VERSION,
      project: 'demo',
      repoRoot: '/tmp/demo',
      groups: [
        {
          label: 'packages/core',
          priority: 10,
          tasks: [
            {
              id: 'task-core-storage',
              titleHint: 'Vault storage layer',
              candidateType: 'architecture_design',
              paths: ['packages/core/src/storage'],
              suggestedAnchors: [{ file: 'packages/core/src/storage/vault.ts' }],
              status: 'todo',
            },
          ],
        },
      ],
      excluded: [
        {
          path: 'node_modules',
          kind: 'dir',
          reason: 'excluded',
          excludeReason: 'noise',
        },
      ],
      stats: {
        modulesScanned: 2,
        modulesSelected: 1,
        modulesExcluded: 1,
        groupCount: 1,
        taskCount: 1,
        tasksAlreadyDone: 0,
      },
      generatedAt: new Date().toISOString(),
    });
    expect(plan.version).toBe('1');
    expect(plan.groups[0]?.tasks[0]?.candidateType).toBe('architecture_design');
  });

  it('given dig task without body when parse then ok', () => {
    const task = DigTaskSchema.parse({
      id: 't1',
      titleHint: 'CLI coverage',
      candidateType: 'tool_usage',
      paths: ['packages/cli/src/commands/coverage.ts'],
    });
    expect(task.status).toBe('todo');
    expect(task.suggestedAnchors).toEqual([]);
  });

  it('given dig group with planNotes when parse then ok', () => {
    const plan = BootstrapPlanSchema.parse({
      version: BOOTSTRAP_PLAN_VERSION,
      project: 'demo',
      repoRoot: '/tmp/demo',
      groups: [
        {
          label: 'g',
          priority: 5,
          planNotes: 'watch NPE',
          tasks: [
            {
              id: 'dig-a',
              titleHint: 'a',
              candidateType: 'architecture_design',
              paths: ['a'],
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
    });
    expect(plan.groups[0]?.planNotes).toBe('watch NPE');
  });
});
