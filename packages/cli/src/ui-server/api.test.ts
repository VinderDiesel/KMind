import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { createVault, SqliteStore } from '@kmind/core';
import { handleUiApi } from './api.js';

describe('handleUiApi', () => {
  let dir: string;
  let store: SqliteStore;
  let vault: ReturnType<typeof createVault>;

  beforeEach(async () => {
    resetFactoryCounters();
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-ui-api-'));
    vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const a = createKnowledgeAsset({
      id: 'k-2026-01-01-001',
      title: 'advisory lock',
      type: 'pitfall',
    });
    const b = createKnowledgeAsset({
      id: 'k-2026-01-01-002',
      title: 'redis alternative',
      type: 'best_practice',
    });
    b.related = [a.id];
    await store.upsertAsset(a);
    await store.upsertAsset(b);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given status when GET then returns assetCount', async () => {
    const res = await handleUiApi(
      { vault, store },
      'GET',
      '/api/status',
      new URLSearchParams(),
    );
    expect(res.status).toBe(200);
    expect((res.body as { assetCount: number }).assetCount).toBe(2);
  });

  it('given search when GET then returns hits', async () => {
    const res = await handleUiApi(
      { vault, store },
      'GET',
      '/api/search',
      new URLSearchParams({ q: 'advisory' }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { results: Array<{ id: string }> };
    expect(body.results.some((r) => r.id === 'k-2026-01-01-001')).toBe(true);
  });

  it('given ego when GET then returns hop graph', async () => {
    const res = await handleUiApi(
      { vault, store },
      'GET',
      '/api/ego/k-2026-01-01-002',
      new URLSearchParams({ depth: '1' }),
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      focusId: string;
      nodes: Array<{ id: string; hop: number }>;
      links: unknown[];
    };
    expect(body.focusId).toBe('k-2026-01-01-002');
    expect(body.nodes.length).toBeGreaterThanOrEqual(2);
    expect(body.nodes.find((n) => n.id === 'k-2026-01-01-002')?.hop).toBe(0);
  });

  it('given missing asset when GET ego then 404', async () => {
    const res = await handleUiApi(
      { vault, store },
      'GET',
      '/api/ego/k-2099-01-01-001',
      new URLSearchParams(),
    );
    expect(res.status).toBe(404);
  });

  it('given POST when any route then 405', async () => {
    const res = await handleUiApi(
      { vault, store },
      'POST',
      '/api/status',
      new URLSearchParams(),
    );
    expect(res.status).toBe(405);
  });
});
