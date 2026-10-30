import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Adapter } from '../adapters/types.js';
import { createVault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { OntologyRegistry } from '../ontology/ontology-registry.js';
import { loadOntology } from '../ontology/ontology-loader.js';
import { runAdapterMaintenance } from './maintenance.js';

function mockAdapter(name: string, sessionFile: string): Adapter {
  return {
    name,
    version: '0.0.0',
    async detect() {
      return true;
    },
    async getSessionPaths() {
      return [sessionFile];
    },
    async parseSession(p: string) {
      return {
        terminal: 'cursor' as const,
        sessionId: path.basename(p, path.extname(p)),
        startedAt: '2026-10-20T00:00:00.000Z',
        messages: [
          {
            role: 'user' as const,
            content: 'hello from schedule test',
            timestamp: '2026-10-20T00:00:00.000Z',
          },
        ],
        metadata: { path: p },
      };
    },
    getMcpConfig() {
      return { targetPath: '/tmp/mcp.json', content: {} };
    },
  };
}

describe('runAdapterMaintenance', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-maint-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given mock adapter when maintain then captures raw and finishes lint+reindex', async () => {
    const vaultRoot = path.join(dir, 'vault');
    const vault = createVault(vaultRoot);
    await vault.init();
    const cfg = await vault.getConfig();
    cfg.capture.autoCapture = false;
    cfg.capture.compileSessions = false;
    await vault.saveConfig(cfg);

    const sessionsDir = path.join(dir, 'fake-sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const sessionFile = path.join(sessionsDir, 's1.jsonl');
    writeFileSync(
      sessionFile,
      `${JSON.stringify({ role: 'user', content: 'x', timestamp: '2026-10-20T00:00:00.000Z' })}\n`,
    );

    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));
    const adapter = mockAdapter('cursor', sessionFile);

    const result = await runAdapterMaintenance(
      vault,
      { sqlite: store, registry, adapters: [adapter] },
      'cursor',
    );

    expect(result.adapter).toBe('cursor');
    expect(result.captured).toBe(1);
    expect(result.reindex.assetCount).toBeGreaterThanOrEqual(0);
    expect(typeof result.lint.issueCount).toBe('number');
    expect(result.compile.processed).toBeGreaterThanOrEqual(0);

    store.close();
  });

  it('given unknown adapter when maintain then throws', async () => {
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));
    await expect(
      runAdapterMaintenance(
        vault,
        { sqlite: store, registry, adapters: [] },
        'nope',
      ),
    ).rejects.toThrow(/Unknown adapter/);
    store.close();
  });
});
