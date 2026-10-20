import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset } from '@kmind/shared';
import { SqliteStore } from '../storage/sqlite-store.js';
import { getProblemStatus } from './problem-status.js';

describe('getProblemStatus', () => {
  let dir: string;
  let store: SqliteStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-prob-'));
    store = new SqliteStore(path.join(dir, 'index.db'));
    await store.migrate();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given problem with solves and verifies when status then verified', async () => {
    const problem = createKnowledgeAsset({
      id: 'k-2026-10-19-001',
      type: 'problem',
      title: 'JOIN 路径丢失',
    });
    const solution = createKnowledgeAsset({
      id: 'k-2026-10-19-002',
      type: 'problem_solution',
      title: '改投影策略',
      links: [{ id: problem.id, relation: 'solves' }],
    });
    const outcome = createKnowledgeAsset({
      id: 'k-2026-10-19-003',
      type: 'outcome',
      title: '样例4 通过',
      links: [{ id: problem.id, relation: 'verifies' }],
    });
    await store.upsertAsset(problem);
    await store.upsertAsset(solution);
    await store.upsertAsset(outcome);

    const report = await getProblemStatus(store, problem.id);
    expect(report).toMatchObject({ status: 'verified' });
    if ('solutions' in report) {
      expect(report.solutions).toHaveLength(1);
      expect(report.outcomes).toHaveLength(1);
    }
  });

  it('given only solves when status then addressed', async () => {
    const problem = createKnowledgeAsset({
      id: 'k-2026-10-19-010',
      type: 'problem',
      title: '开放问题',
    });
    const solution = createKnowledgeAsset({
      id: 'k-2026-10-19-011',
      type: 'problem_solution',
      title: '方案草稿',
      links: [{ id: problem.id, relation: 'solves' }],
    });
    await store.upsertAsset(problem);
    await store.upsertAsset(solution);
    const report = await getProblemStatus(store, problem.id);
    expect(report).toMatchObject({ status: 'addressed' });
  });
});
