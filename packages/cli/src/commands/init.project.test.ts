import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createVault, PROJECT_VAULT_DIRNAME } from '@kmind/core';
import { cmdInit } from './init.js';
import type { AppContext } from '../context.js';

describe('cmdInit --project', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-init-project-'));
    spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given git repo when init project then creates vault agents and hooks', async () => {
    const homeVault = createVault(path.join(dir, 'home-vault'));
    await homeVault.init();
    const { SqliteStore } = await import('@kmind/core');
    const store = new SqliteStore(homeVault.indexPath);
    await store.migrate();

    const ctx = {
      vault: homeVault,
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
      await cmdInit(ctx, { project: true, cwd: dir });
    } finally {
      process.stdout.write = origWrite;
      store.close();
    }

    const vaultPath = path.join(dir, PROJECT_VAULT_DIRNAME);
    expect(existsSync(path.join(vaultPath, 'config.yaml'))).toBe(true);
    expect(existsSync(path.join(vaultPath, '.gitignore'))).toBe(true);
    expect(existsSync(path.join(vaultPath, 'FEATURE_TREE.md'))).toBe(true);
    expect(readFileSync(path.join(vaultPath, 'FEATURE_TREE.md'), 'utf8')).toContain(
      'kmind:feature-tree-guide',
    );
    expect(readFileSync(path.join(vaultPath, '.gitignore'), 'utf8')).toContain(
      'index.db',
    );
    expect(existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(path.join(dir, '.githooks', 'pre-commit'))).toBe(true);
    const out = Buffer.concat(chunks).toString('utf8');
    expect(out).toContain('"ok":true');
  });

  it('given no git when init project then throws', async () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'kmind-init-bare-'));
    mkdirSync(path.join(bare, 'subdir'), { recursive: true });
    const homeVault = createVault(path.join(bare, 'home-vault'));
    await homeVault.init();
    const { SqliteStore } = await import('@kmind/core');
    const store = new SqliteStore(homeVault.indexPath);
    await store.migrate();
    const ctx = {
      vault: homeVault,
      store,
      json: true,
      registry: {} as AppContext['registry'],
      evolver: {} as AppContext['evolver'],
      assetTypes: {} as AppContext['assetTypes'],
      adapters: [],
    } as AppContext;

    await expect(
      cmdInit(ctx, { project: true, cwd: path.join(bare, 'subdir') }),
    ).rejects.toThrow(/git repository/i);
    store.close();
    rmSync(bare, { recursive: true, force: true });
  });
});
