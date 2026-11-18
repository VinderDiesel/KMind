import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  appendSearchQueryLog,
  createVault,
  SqliteStore,
} from '@kmind/core';
import type { AppContext } from '../context.js';
import { cmdRecallStats, clampRecallWindowHours } from './recall-stats.js';

describe('cmdRecallStats', () => {
  let dir: string;
  let store: SqliteStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-cli-recall-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given vault with pack log when recall-stats json then status ok', async () => {
    const vault = createVault(path.join(dir, 'vault'));
    await appendSearchQueryLog(vault.auditDir, {
      kind: 'pack',
      query: 'demo',
      project: 'demo',
      resultCount: 1,
      topHits: [{ id: 'k-2026-11-18-001-abcd', score: 1 }],
      empty: false,
      latencyMs: 1,
      source: 'cli',
      focusId: 'k-2026-11-18-001-abcd',
    });

    const ctx = {
      vault,
      store,
      json: true,
      registry: {} as AppContext['registry'],
      evolver: {} as AppContext['evolver'],
      assetTypes: {} as AppContext['assetTypes'],
      adapters: [],
    } as AppContext;

    const chunks: Buffer[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await cmdRecallStats(ctx, { project: 'demo', windowHours: 24 });
    } finally {
      process.stdout.write = origWrite;
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      status: string;
      totals: { pack: number };
    };
    expect(payload.status).toBe('ok');
    expect(payload.totals.pack).toBeGreaterThanOrEqual(1);
  });

  it('given windowHours when clamp then bounds 1..168', () => {
    expect(clampRecallWindowHours(0)).toBe(1);
    expect(clampRecallWindowHours(999)).toBe(168);
    expect(clampRecallWindowHours(24)).toBe(24);
  });
});
