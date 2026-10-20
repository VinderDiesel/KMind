import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createVault,
  SqliteStore,
  Exporter,
  Importer,
  MarkdownStore,
} from '../../packages/core/src/index.js';
import { createKnowledgeAsset, resetFactoryCounters } from '../../packages/shared/src/index.js';

describe('e2e export import', () => {
  let dir: string;

  beforeEach(() => {
    resetFactoryCounters();
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-mig-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given vault assets when export tar.gz and import then assets preserved', async () => {
    const src = path.join(dir, 'src');
    const vault = createVault(src);
    await vault.init();
    const md = new MarkdownStore(vault.knowledgeDir);
    await md.write(
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'event-driven payments',
        type: 'architecture_design',
      }),
    );
    await md.write(
      createKnowledgeAsset({
        id: 'k-2026-01-01-002',
        title: 'retry decorator',
        type: 'code_snippet',
      }),
    );
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    await store.rebuildFromMarkdown(vault.knowledgeDir);
    const before = await store.countAssets();
    expect(before).toBe(2);

    const archive = path.join(dir, 'vault.tar.gz');
    const manifest = await new Exporter(vault).exportToTarGz(archive);
    expect(manifest.assetCount).toBe(before);
    expect(manifest.formatVersion).toBe(1);
    store.close();

    const dest = path.join(dir, 'dest');
    const vault2 = createVault(dest);
    await vault2.init();
    await new Importer(vault2).importFromTarGz(archive);
    const store2 = new SqliteStore(vault2.indexPath);
    expect(await store2.countAssets()).toBe(before);
    store2.close();
  });

  it('given git export when merge conflict skip then preserves local', async () => {
    const local = createVault(path.join(dir, 'local'));
    await local.init();
    const remote = createVault(path.join(dir, 'remote'));
    await remote.init();

    const localMd = new MarkdownStore(local.knowledgeDir);
    const remoteMd = new MarkdownStore(remote.knowledgeDir);
    await localMd.write(
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'local',
      }),
    );
    await remoteMd.write(
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'remote',
      }),
    );
    await remoteMd.write(
      createKnowledgeAsset({
        id: 'k-2026-01-01-002',
        title: 'extra',
      }),
    );

    const pack = path.join(dir, 'pack');
    await new Exporter(remote).exportToGit(pack);
    expect(existsSync(path.join(pack, '.gitignore'))).toBe(true);

    const result = await new Importer(local).importFromDirectory(pack, {
      merge: true,
      conflict: 'skip',
    });
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(1);
    expect((await localMd.read('k-2026-01-01-001'))?.title).toBe('local');
    expect(await localMd.read('k-2026-01-01-002')).not.toBeNull();
  });
});
