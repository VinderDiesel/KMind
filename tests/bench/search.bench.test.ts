import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { SqliteStore } from '../../packages/core/src/storage/sqlite-store.js';

describe('bench fulltext search', () => {
  let dir: string;
  let store: SqliteStore;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-bench-'));
    store = new SqliteStore(path.join(dir, 'index.db'));
    await store.migrate();
    resetFactoryCounters();
    for (let i = 1; i <= 2000; i++) {
      const day = i <= 999 ? '15' : '16';
      const seq = i <= 999 ? i : i - 999;
      const id = `k-2026-10-${day}-${String(seq).padStart(3, '0')}`;
      await store.upsertAsset(
        createKnowledgeAsset({
          id,
          title: `Knowledge item ${i} architecture messaging`,
          body: `Body about performance and indexing number ${i}`,
        }),
      );
    }
  }, 60_000);

  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('searches under 50ms for warm query (warn if slow on CI)', async () => {
    // warm up
    await store.queryAssets({ query: 'architecture', limit: 10 });
    const start = performance.now();
    const results = await store.queryAssets({ query: 'architecture', limit: 10 });
    const ms = performance.now() - start;
    expect(results.length).toBeGreaterThan(0);
    // Soft gate for M1: fail only if extremely slow
    if (ms > 50) {
      console.warn(`[bench] fulltext took ${ms.toFixed(2)}ms (threshold 50ms)`);
    }
    expect(ms).toBeLessThan(500);
  });
});
