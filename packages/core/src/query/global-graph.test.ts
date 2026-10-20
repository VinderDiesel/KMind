import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { createVault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { buildGlobalGraph } from './global-graph.js';

describe('buildGlobalGraph', () => {
  let dir: string;
  let store: SqliteStore;

  beforeEach(async () => {
    resetFactoryCounters();
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-global-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given assets with edges when build then prefers connected nodes under cap', async () => {
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-01-01-002',
        title: 'leaf-a',
        type: 'best_practice',
        project: 'alpha',
      }),
    );
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-01-01-003',
        title: 'leaf-b',
        type: 'pitfall',
        project: 'alpha',
      }),
    );
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-01-01-004',
        title: 'orphan',
        type: 'tool_usage',
        project: 'alpha',
      }),
    );
    const a = createKnowledgeAsset({
      id: 'k-2026-01-01-001',
      title: 'hub',
      type: 'architecture_design',
      project: 'alpha',
    });
    a.related = ['k-2026-01-01-002', 'k-2026-01-01-003'];
    await store.upsertAsset(a);

    const g = await buildGlobalGraph(store, { nodeCap: 3 });
    expect(g.mode).toBe('global');
    expect(g.truncated).toBe(true);
    expect(g.totalCandidates).toBe(4);
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes.map((n) => n.id)).toContain('k-2026-01-01-001');
    expect(g.nodes.map((n) => n.id)).not.toContain('k-2026-01-01-004');
    expect(g.links.length).toBeGreaterThan(0);
  });

  it('given project filter when build then only that project', async () => {
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'a',
        project: 'alpha',
      }),
    );
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-01-01-002',
        title: 'b',
        project: 'beta',
      }),
    );

    const g = await buildGlobalGraph(store, { project: 'alpha' });
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]?.project).toBe('alpha');
    expect(g.project).toBe('alpha');
  });

  it('given type filter when build then only matching types', async () => {
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'prob',
        type: 'problem',
      }),
    );
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-01-01-002',
        title: 'prac',
        type: 'best_practice',
      }),
    );

    const g = await buildGlobalGraph(store, { types: ['problem'] });
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]?.type).toBe('problem');
  });

  it('given health issues when build then flags nodes', async () => {
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'x',
      }),
    );
    const g = await buildGlobalGraph(store, {
      healthIssues: [
        {
          rule: 'expiry',
          severity: 'high',
          assetId: 'k-2026-01-01-001',
          message: 'stale',
        },
      ],
    });
    expect(g.nodes[0]?.hasHealthIssue).toBe(true);
  });
});
