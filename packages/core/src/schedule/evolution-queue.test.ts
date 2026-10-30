import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { createVault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import {
  loadEvolutionQueue,
  runEvolutionScan,
  updateEvolutionTodoStatus,
} from './evolution-queue.js';

describe('evolution queue', () => {
  let dir: string;
  let store: SqliteStore;
  let vaultRoot: string;

  beforeEach(async () => {
    resetFactoryCounters();
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-evo-'));
    vaultRoot = path.join(dir, 'vault');
    const vault = createVault(vaultRoot);
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given project assets when scan then persists open todos', async () => {
    const vault = createVault(vaultRoot);
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-10-30-200',
        title: '问数知识总览',
        type: 'architecture_design',
        project: 'demo',
        body: '## 导航\nthin hub\n',
        related: [],
      }),
    );
    const { queue, path: qpath } = await runEvolutionScan(vault, store);
    expect(qpath).toContain('evolution-queue.json');
    expect(queue.version).toBe('1');
    expect(queue.summary.projects).toBe(1);
    expect(queue.summary.open).toBeGreaterThan(0);
    const loaded = await loadEvolutionQueue(vault);
    expect(loaded.summary.open).toBe(queue.summary.open);
  });

  it('given ack done when rescan then preserves done status for same id', async () => {
    const vault = createVault(vaultRoot);
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-10-30-201',
        title: '问数知识总览',
        type: 'architecture_design',
        project: 'demo',
        body: '## 导航\nthin\n',
      }),
    );
    const first = await runEvolutionScan(vault, store);
    const openId = first.queue.items.find((i) => i.status === 'open')?.id;
    expect(openId).toBeTruthy();
    await updateEvolutionTodoStatus(vault, openId!, 'done');
    const second = await runEvolutionScan(vault, store);
    const again = second.queue.items.find((i) => i.id === openId);
    expect(again?.status).toBe('done');
  });
});
