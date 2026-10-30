import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { createVault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { buildContextPack } from './context-pack.js';

describe('buildContextPack', () => {
  let dir: string;
  let store: SqliteStore;

  beforeEach(async () => {
    resetFactoryCounters();
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-pack-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given neither id nor query when pack then hints require input', async () => {
    const pack = await buildContextPack(store, {});
    expect(pack.focus).toBeNull();
    expect(pack.hints[0]).toMatch(/id or query/i);
  });

  it('given missing id when pack then not found', async () => {
    const pack = await buildContextPack(store, { id: 'k-2099-01-01-001' });
    expect(pack.focus).toBeNull();
    expect(pack.hints.some((h) => /not found/i.test(h))).toBe(true);
  });

  it('given focus with neighbor and anchors when pack then assembles structured pack', async () => {
    const neighbor = createKnowledgeAsset({
      id: 'k-2026-10-30-002',
      title: 'Neighbor practice',
      type: 'best_practice',
      body: '## 实现方式\nneighbor detail with enough text for excerpt\n',
    });
    await store.upsertAsset(neighbor);

    const focus = createKnowledgeAsset({
      id: 'k-2026-10-30-001',
      title: 'Focus architecture',
      type: 'architecture_design',
      related: ['k-2026-10-30-002'],
      body: [
        '## 实现方式',
        'Use createPipeline in packages/core/src/compiler/pipeline.ts',
        '## 代码锚点',
        '- `packages/core/src/compiler/pipeline.ts` · `createPipeline`',
        '## 注意事项',
        '- gate sessions',
        '## 红线规避',
        '- 禁止 auto promote sessions',
      ].join('\n'),
    });
    await store.upsertAsset(focus);

    const pack = await buildContextPack(store, { id: focus.id, depth: 1 });
    expect(pack.version).toBe('1');
    expect(pack.focus?.id).toBe(focus.id);
    expect(pack.focus?.bodyExcerpt.length).toBeGreaterThan(20);
    expect(pack.codeAnchors.length).toBeGreaterThan(0);
    expect(pack.neighborhood?.nodes.some((n) => n.id === neighbor.id)).toBe(
      true,
    );
    expect(pack.related.some((r) => r.id === neighbor.id)).toBe(true);
  });

  it('given problem focus when pack then includes problemStatus', async () => {
    const problem = createKnowledgeAsset({
      id: 'k-2026-10-30-010',
      title: 'Open join path',
      type: 'problem',
      body: '## 症状\nNO_JOIN_PATH\n## 复现\n1. run ask\n## 验收\npath exists\n',
    });
    await store.upsertAsset(problem);
    const pack = await buildContextPack(store, { id: problem.id });
    expect(pack.problemStatus?.status).toBe('open');
    expect(pack.hints.some((h) => /open/i.test(h))).toBe(true);
  });
});
