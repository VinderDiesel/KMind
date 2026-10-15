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
} from '../../packages/core/src/index.js';

describe('e2e incremental compile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-inc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given unchanged raw when recompile then skips', async () => {
    const vault = createVault(dir);
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
        content: 'tool usage: kmind search',
        timestamp: '2026-10-15T12:00:00.000Z',
      })}\n`,
    );

    const pipeline = createPipeline(vault, { sqlite: store, registry });
    const first = await pipeline.run({ incremental: true, force: true });
    expect(first.created).toBeGreaterThan(0);
    const second = await pipeline.run({ incremental: true });
    expect(second.skipped).toBeGreaterThan(0);
    store.close();
  });
});
