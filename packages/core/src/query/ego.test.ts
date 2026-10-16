import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { createVault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { buildEgoGraph, filterEgoHealthIssues } from './ego.js';

describe('buildEgoGraph', () => {
  let dir: string;
  let store: SqliteStore;

  beforeEach(async () => {
    resetFactoryCounters();
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-ego-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given missing focus when build then returns null', async () => {
    const g = await buildEgoGraph(store, 'k-2026-01-01-001');
    expect(g).toBeNull();
  });

  it('given star neighborhood when build then assigns hop shells and truncates', async () => {
    const leafIds = [
      'k-2026-01-01-002',
      'k-2026-01-01-003',
      'k-2026-01-01-004',
      'k-2026-01-01-005',
      'k-2026-01-01-006',
    ];
    for (const id of leafIds) {
      await store.upsertAsset(
        createKnowledgeAsset({ id, title: id, type: 'best_practice' }),
      );
    }
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-01-01-099',
        title: 'far',
        type: 'pitfall',
      }),
    );
    // 2-hop edge via leaf 002 → 099
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-01-01-002',
        title: 'leaf-2',
        type: 'best_practice',
        // related rewritten below via focus
      }),
    );
    // Patch leaf 002 to point at far node
    const leaf2 = await store.getAsset('k-2026-01-01-002');
    expect(leaf2).not.toBeNull();
    await store.upsertAsset({ ...leaf2!, related: ['k-2026-01-01-099'] });

    const focus = createKnowledgeAsset({
      id: 'k-2026-01-01-001',
      title: 'focus',
      type: 'architecture_design',
    });
    focus.related = leafIds;
    await store.upsertAsset(focus);

    const g = await buildEgoGraph(store, focus.id, {
      depth: 2,
      nodeCap: 4,
      healthIssues: [
        {
          rule: 'expiry',
          severity: 'high',
          assetId: 'k-2026-01-01-002',
          message: 'stale',
        },
      ],
    });
    expect(g).not.toBeNull();
    expect(g!.truncated).toBe(true);
    expect(g!.nodes.length).toBe(4);
    expect(g!.nodes[0]?.id).toBe(focus.id);
    expect(g!.nodes[0]?.hop).toBe(0);
    expect(g!.nodes.every((n) => n.hop <= 1)).toBe(true);
    expect(
      g!.nodes.find((n) => n.id === 'k-2026-01-01-002')?.hasHealthIssue,
    ).toBe(true);
  });

  it('given issues when filterEgoHealthIssues then keeps matching assets', () => {
    const out = filterEgoHealthIssues(
      [
        { rule: 'a', severity: 'low', assetId: 'k-1', message: 'x' },
        { rule: 'b', severity: 'low', assetId: 'k-2', message: 'y' },
        { rule: 'c', severity: 'low', message: 'no id' },
      ],
      new Set(['k-1']),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.assetId).toBe('k-1');
  });
});
