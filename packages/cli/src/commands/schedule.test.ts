import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createVault,
  loadScheduleState,
  SqliteStore,
  OntologyRegistry,
  OntologyEvolver,
  loadOntology,
  type Adapter,
} from '@kmind/core';
import { KMindError } from '@kmind/shared';
import type { AppContext } from '../context.js';
import {
  cmdScheduleSet,
  cmdScheduleUnset,
  executeScheduleRun,
} from './schedule.js';

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
            content: 'hello',
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

describe('schedule commands', () => {
  let dir: string;
  let ctx: AppContext;
  let sessionFile: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-sched-cli-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));
    const evolver = new OntologyEvolver(vault.ontologyDir, registry);

    const sessionsDir = path.join(dir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    sessionFile = path.join(sessionsDir, 's1.jsonl');
    writeFileSync(
      sessionFile,
      `${JSON.stringify({ role: 'user', content: 'x', timestamp: '2026-10-20T00:00:00.000Z' })}\n`,
    );

    ctx = {
      vault,
      store,
      registry,
      evolver,
      adapters: [mockAdapter('cursor', sessionFile)],
      json: true,
    };
  });

  afterEach(() => {
    ctx.store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given valid cron when set then persists in config', async () => {
    await cmdScheduleSet(ctx, 'cursor', '0 */6 * * *');
    const cfg = await ctx.vault.getConfig();
    expect(cfg.adapters.cursor?.schedule).toBe('0 */6 * * *');
  });

  it('given invalid cron when set then throws', async () => {
    await expect(cmdScheduleSet(ctx, 'cursor', 'not-a-cron')).rejects.toThrow(
      KMindError,
    );
  });

  it('given set then unset when read then schedule gone', async () => {
    await cmdScheduleSet(ctx, 'cursor', '0 2 * * *');
    await cmdScheduleUnset(ctx, 'cursor');
    const cfg = await ctx.vault.getConfig();
    expect(cfg.adapters.cursor?.schedule).toBeUndefined();
  });

  it('given force run when execute then updates schedule state', async () => {
    await cmdScheduleSet(ctx, 'cursor', '0 2 * * *');
    const payload = await executeScheduleRun(ctx, {
      adapter: 'cursor',
      force: true,
    });
    expect(payload.ran).toHaveLength(1);
    expect(payload.ran[0]?.ok).toBe(true);
    expect(payload.ran[0]?.result?.captured).toBe(1);
    const state = await loadScheduleState(ctx.vault);
    expect(state.runs.cursor?.lastOk).toBe(true);
    expect(state.runs.cursor?.lastSlot).toBeTruthy();
  });

  it('given --daemon when start via CLI then prints pid and process stays alive', async () => {
    const cli = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../dist/index.js',
    );
    const vaultPath = ctx.vault.root;
    const started = spawnSync(
      process.execPath,
      [cli, '--vault', vaultPath, 'schedule', 'start', '--daemon'],
      { encoding: 'utf8' },
    );
    expect(started.status).toBe(0);
    const pid = Number(started.stdout.trim().split('\n').pop());
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    process.kill(pid, 0);
    const stopped = spawnSync(
      process.execPath,
      [cli, '--vault', vaultPath, '--json', 'schedule', 'stop'],
      { encoding: 'utf8' },
    );
    expect(stopped.status).toBe(0);
    await new Promise((r) => setTimeout(r, 300));
  });
});
