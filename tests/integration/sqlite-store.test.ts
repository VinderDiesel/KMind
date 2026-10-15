import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { SqliteStore } from '../../packages/core/src/storage/sqlite-store.js';
import { MarkdownStore } from '../../packages/core/src/storage/markdown-store.js';

describe('SqliteStore integration', () => {
  let dir: string;
  let store: SqliteStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-'));
    store = new SqliteStore(path.join(dir, 'index.db'));
    await store.migrate();
    resetFactoryCounters();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given assets when upsert and query then returns them', async () => {
    const a = createKnowledgeAsset({ title: 'Payment architecture' });
    await store.upsertAsset(a);
    const found = await store.getAsset(a.id);
    expect(found?.title).toBe('Payment architecture');
    const results = await store.queryAssets({ query: 'Payment', limit: 5 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('given markdown when rebuildFromMarkdown then data consistent', async () => {
    const knowledgeDir = path.join(dir, 'knowledge');
    const md = new MarkdownStore(knowledgeDir);
    const a = createKnowledgeAsset({ id: 'k-2026-10-15-001', title: 'Rebuild me' });
    await md.write(a);
    await store.rebuildFromMarkdown(knowledgeDir);
    const found = await store.getAsset('k-2026-10-15-001');
    expect(found?.title).toBe('Rebuild me');
  });

  it('given 1000 inserts when upsert then completes under 5s', async () => {
    const start = Date.now();
    for (let i = 1; i <= 1000; i++) {
      const id = `k-2026-10-15-${String(i).padStart(3, '0')}`;
      // allow ids beyond 999 by clamping pattern for bulk - use valid day batch
      const safeId =
        i <= 999
          ? id
          : `k-2026-10-16-${String(i - 999).padStart(3, '0')}`;
      await store.upsertAsset(
        createKnowledgeAsset({ id: safeId, title: `Item ${i}` }),
      );
    }
    expect(Date.now() - start).toBeLessThan(5000);
    expect(await store.countAssets()).toBe(1000);
  });
});
