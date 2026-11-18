import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

  it('given open DigTask when evolution scan then item has digTaskId and groupLabel', async () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'kmind-evo-repo-'));
    const src = path.join(repo, 'packages', 'core', 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(
      path.join(src, 'storage.ts'),
      'export function createVault() {}\n',
      'utf8',
    );
    const projectVaultRoot = path.join(repo, '.kmind-knowledge');
    const vault = createVault(projectVaultRoot);
    await vault.init();
    const repoStore = new SqliteStore(vault.indexPath);
    await repoStore.migrate();
    await repoStore.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-11-18-300',
        title: 'demo 总览',
        type: 'architecture_design',
        project: 'demo',
        body: '## 导航\nthin hub\n',
      }),
    );
    try {
      const { queue } = await runEvolutionScan(vault, repoStore);
      const boot = queue.items.find(
        (i) => i.source === 'bootstrap' && i.code === 'dig_task',
      );
      expect(boot?.digTaskId).toMatch(/^dig-/);
      expect(boot?.groupLabel).toBeTruthy();
      expect(boot?.nextAction).toContain('bootstrapTask=');
    } finally {
      repoStore.close();
      rmSync(repo, { recursive: true, force: true });
    }
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
