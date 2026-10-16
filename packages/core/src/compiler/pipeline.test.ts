import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { OntologyRegistry } from '../ontology/ontology-registry.js';
import { loadOntology } from '../ontology/ontology-loader.js';
import { createPipeline } from './pipeline.js';

describe('compile pipeline confidence gate', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-gate-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given low-confidence adapter raw when compile then gates without creating asset', async () => {
    const vault = createVault(dir);
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));

    const adapterDir = path.join(vault.rawDir, 'cursor');
    mkdirSync(adapterDir, { recursive: true });
    writeFileSync(
      path.join(adapterDir, 'noise.jsonl'),
      `${JSON.stringify({
        role: 'user',
        content: 'hello world casually chatting about weather today',
        timestamp: '2026-10-16T12:00:00.000Z',
      })}\n`,
    );

    const pipeline = createPipeline(vault, { sqlite: store, registry });
    const result = await pipeline.run({
      incremental: false,
      force: true,
      minConfidence: 0.6,
    });

    expect(result.gated).toBe(1);
    expect(result.created).toBe(0);
    const assets = await store.queryAssets({ limit: 10 });
    expect(assets).toHaveLength(0);
    const raw = await store.getRawHash(path.join('cursor', 'noise.jsonl'));
    expect(raw?.status).toBe('pending');
    store.close();
  });

  it('given manual typeHint when compile then bypasses gate', async () => {
    const vault = createVault(dir);
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));

    const manualDir = path.join(vault.rawDir, 'manual');
    mkdirSync(manualDir, { recursive: true });
    writeFileSync(
      path.join(manualDir, 'note.jsonl'),
      `${JSON.stringify({
        role: 'user',
        title: 'path.join only',
        type: 'best_practice',
        project: 'kmind',
        content: 'Always use path.join; never hand-write slashes.',
        timestamp: '2026-10-16T12:00:00.000Z',
      })}\n`,
    );

    const pipeline = createPipeline(vault, { sqlite: store, registry });
    const result = await pipeline.run({
      incremental: false,
      force: true,
      minConfidence: 0.99,
    });

    expect(result.gated).toBe(0);
    expect(result.created).toBe(1);
    store.close();
  });
});
