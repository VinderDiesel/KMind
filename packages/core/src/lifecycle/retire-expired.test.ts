import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { createVault, MarkdownStore, SqliteStore } from '../index.js';
import {
  deprecateAllExpired,
  listExpiredAssets,
  retireExpired,
} from './retire-expired.js';

describe('retireExpired', () => {
  let dir: string;
  let store: SqliteStore;
  let markdown: MarkdownStore;

  beforeEach(async () => {
    resetFactoryCounters();
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-retire-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
    markdown = new MarkdownStore(vault.knowledgeDir);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given expired asset when list then returns brief', () => {
    const a = createKnowledgeAsset({
      id: 'k-2026-11-12-001',
      title: 'old',
      project: 'p',
    });
    Object.assign(a, { expiresAt: '2020-01-01T00:00:00.000Z' });
    const list = listExpiredAssets([a], {
      project: 'p',
      now: new Date('2026-11-12T00:00:00.000Z'),
    });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(a.id);
  });

  it('given deprecate when retire then status deprecated and out of list', async () => {
    const a = createKnowledgeAsset({
      id: 'k-2026-11-12-002',
      title: 'old',
      project: 'p',
    });
    Object.assign(a, { expiresAt: '2020-01-01T00:00:00.000Z' });
    await markdown.write(a);
    await store.upsertAsset(a);

    const result = await retireExpired({
      store,
      markdown,
      assets: [a],
      action: 'deprecate',
      id: a.id,
      now: new Date('2026-11-12T00:00:00.000Z'),
    });
    expect(result.updated).toEqual([a.id]);
    const next = await store.getAsset(a.id);
    expect(next?.status).toBe('deprecated');
    expect(next?.expiresAt).toBeNull();
    expect(
      listExpiredAssets([next!], { now: new Date('2026-11-12T00:00:00.000Z') }),
    ).toHaveLength(0);
  });

  it('given supersede when retire then new links supersedes and old deprecated', async () => {
    const oldA = createKnowledgeAsset({
      id: 'k-2026-11-12-003',
      title: 'old',
      project: 'p',
    });
    Object.assign(oldA, { expiresAt: '2020-01-01T00:00:00.000Z' });
    const neu = createKnowledgeAsset({
      id: 'k-2026-11-12-004',
      title: 'new',
      project: 'p',
    });
    await markdown.write(oldA);
    await markdown.write(neu);
    await store.upsertAsset(oldA);
    await store.upsertAsset(neu);

    const result = await retireExpired({
      store,
      markdown,
      assets: [oldA, neu],
      action: 'supersede',
      id: oldA.id,
      by: neu.id,
    });
    expect(result.updated).toEqual([oldA.id, neu.id]);
    const oldNext = await store.getAsset(oldA.id);
    const newNext = await store.getAsset(neu.id);
    expect(oldNext?.status).toBe('deprecated');
    expect(
      newNext?.links.some(
        (l) => l.id === oldA.id && l.relation === 'supersedes',
      ),
    ).toBe(true);
  });

  it('given refresh when retire then clears expiresAt', async () => {
    const a = createKnowledgeAsset({
      id: 'k-2026-11-12-005',
      title: 'keep',
      project: 'p',
    });
    Object.assign(a, { expiresAt: '2020-01-01T00:00:00.000Z' });
    await markdown.write(a);
    await store.upsertAsset(a);
    await retireExpired({
      store,
      markdown,
      assets: [a],
      action: 'refresh',
      id: a.id,
    });
    const next = await store.getAsset(a.id);
    expect(next?.expiresAt).toBeNull();
    expect(next?.status).not.toBe('deprecated');
  });

  it('given deprecateAll when project has two expired then both deprecated', async () => {
    const a = createKnowledgeAsset({
      id: 'k-2026-11-12-006',
      title: 'a',
      project: 'p',
    });
    const b = createKnowledgeAsset({
      id: 'k-2026-11-12-007',
      title: 'b',
      project: 'p',
    });
    Object.assign(a, { expiresAt: '2020-01-01T00:00:00.000Z' });
    Object.assign(b, { expiresAt: '2021-01-01T00:00:00.000Z' });
    await markdown.write(a);
    await markdown.write(b);
    await store.upsertAsset(a);
    await store.upsertAsset(b);
    const result = await deprecateAllExpired({
      store,
      markdown,
      assets: [a, b],
      project: 'p',
      now: new Date('2026-11-12T00:00:00.000Z'),
    });
    expect(result.updated).toHaveLength(2);
    expect((await store.getAsset(a.id))?.status).toBe('deprecated');
    expect((await store.getAsset(b.id))?.status).toBe('deprecated');
  });
});
