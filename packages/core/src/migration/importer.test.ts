import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { createVault } from '../storage/vault.js';
import { MarkdownStore } from '../storage/markdown-store.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { Exporter } from './exporter.js';
import { Importer } from './importer.js';

describe('Importer', () => {
  let dir: string;

  beforeEach(() => {
    resetFactoryCounters();
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-imp-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedVault(root: string, assets: ReturnType<typeof createKnowledgeAsset>[]) {
    const vault = createVault(root);
    await vault.init();
    const md = new MarkdownStore(vault.knowledgeDir);
    for (const a of assets) await md.write(a);
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    await store.rebuildFromMarkdown(vault.knowledgeDir);
    store.close();
    return vault;
  }

  it('given merge skip when same id then keeps local', async () => {
    const local = await seedVault(path.join(dir, 'local'), [
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'local-title',
      }),
    ]);
    const remote = await seedVault(path.join(dir, 'remote'), [
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'remote-title',
      }),
      createKnowledgeAsset({
        id: 'k-2026-01-01-002',
        title: 'new',
      }),
    ]);
    const gitDir = path.join(dir, 'pack');
    await new Exporter(remote).exportToGit(gitDir);

    const result = await new Importer(local).importFromDirectory(gitDir, {
      merge: true,
      conflict: 'skip',
    });
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(1);
    const md = new MarkdownStore(local.knowledgeDir);
    const a = await md.read('k-2026-01-01-001');
    expect(a?.title).toBe('local-title');
    expect(await md.read('k-2026-01-01-002')).not.toBeNull();
  });

  it('given merge overwrite when same id then replaces', async () => {
    const local = await seedVault(path.join(dir, 'local'), [
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'local-title',
      }),
    ]);
    const remote = await seedVault(path.join(dir, 'remote'), [
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'remote-title',
      }),
    ]);
    const gitDir = path.join(dir, 'pack');
    await new Exporter(remote).exportToGit(gitDir);

    const result = await new Importer(local).importFromDirectory(gitDir, {
      merge: true,
      conflict: 'overwrite',
    });
    expect(result.overwritten).toBe(1);
    const a = await new MarkdownStore(local.knowledgeDir).read(
      'k-2026-01-01-001',
    );
    expect(a?.title).toBe('remote-title');
  });

  it('given merge rename when same id then allocates new id', async () => {
    const local = await seedVault(path.join(dir, 'local'), [
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'local-title',
      }),
    ]);
    const remote = await seedVault(path.join(dir, 'remote'), [
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'remote-title',
      }),
    ]);
    const gitDir = path.join(dir, 'pack');
    await new Exporter(remote).exportToGit(gitDir);

    const result = await new Importer(local).importFromDirectory(gitDir, {
      merge: true,
      conflict: 'rename',
    });
    expect(result.renamed).toBe(1);
    const md = new MarkdownStore(local.knowledgeDir);
    const files = await md.list();
    expect(files.length).toBe(2);
    const titles = [];
    for (const f of files) {
      titles.push((await md.readFile(f)).title);
    }
    expect(titles).toContain('local-title');
    expect(titles).toContain('remote-title');
  });
});
