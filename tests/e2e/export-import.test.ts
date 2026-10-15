import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createVault,
  SqliteStore,
  OntologyRegistry,
  loadOntology,
  createPipeline,
  Exporter,
  Importer,
} from '../../packages/core/src/index.js';

describe('e2e export import', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-mig-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given compiled vault when export and import then assets preserved', async () => {
    const src = path.join(dir, 'src');
    const vault = createVault(src);
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));
    mkdirSync(path.join(vault.rawDir, 'manual'), { recursive: true });
    writeFileSync(
      path.join(vault.rawDir, 'manual', 'a.jsonl'),
      `${JSON.stringify({
        role: 'user',
        content: 'Architecture design for event-driven payments',
        timestamp: '2026-10-15T12:00:00.000Z',
      })}\n`,
    );
    await createPipeline(vault, { sqlite: store, registry }).run({ force: true });
    const before = await store.countAssets();
    expect(before).toBeGreaterThan(0);

    const archive = path.join(dir, 'vault.tar.gz');
    await new Exporter(vault).exportToTarGz(archive);
    store.close();

    const dest = path.join(dir, 'dest');
    const vault2 = createVault(dest);
    await vault2.init();
    await new Importer(vault2).importFromTarGz(archive);
    const store2 = new SqliteStore(vault2.indexPath);
    expect(await store2.countAssets()).toBe(before);
    store2.close();
  });
});
