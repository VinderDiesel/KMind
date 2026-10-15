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
  createQueryEngine,
} from '../../packages/core/src/index.js';

describe('e2e init and compile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-e2e-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given init and raw when compile and search then finds asset', async () => {
    const vault = createVault(dir);
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));

    const rawDir = path.join(vault.rawDir, 'manual');
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(
      path.join(rawDir, 'note.jsonl'),
      `${JSON.stringify({
        role: 'user',
        content: 'Best practice: always use path.join for filesystem paths',
        timestamp: '2026-10-15T12:00:00.000Z',
      })}\n`,
    );

    const pipeline = createPipeline(vault, { sqlite: store, registry });
    const result = await pipeline.run({ incremental: false, force: true });
    expect(result.created).toBeGreaterThan(0);

    const engine = createQueryEngine(vault, store);
    const hits = await engine.search({ query: 'path.join', limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.matchedBy.length).toBeGreaterThan(0);
    store.close();
  });
});
