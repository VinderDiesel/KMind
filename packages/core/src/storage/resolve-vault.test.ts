import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import os from 'node:os';
import {
  findProjectVault,
  projectVaultPath,
  resolveVaultRoot,
  PROJECT_VAULT_DIRNAME,
} from './resolve-vault.js';

describe('resolveVaultRoot', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-resolve-vault-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given explicit path when resolve then returns absolute explicit', async () => {
    const explicit = path.join(dir, 'custom-vault');
    const root = await resolveVaultRoot({ explicit, cwd: dir });
    expect(root).toBe(path.resolve(explicit));
  });

  it('given project vault with config when resolve from nested cwd then finds it', async () => {
    const vault = path.join(dir, PROJECT_VAULT_DIRNAME);
    mkdirSync(vault, { recursive: true });
    writeFileSync(path.join(vault, 'config.yaml'), 'version: 0.1.0\n', 'utf8');
    const nested = path.join(dir, 'packages', 'app');
    mkdirSync(nested, { recursive: true });

    const found = await findProjectVault(nested);
    const root = await resolveVaultRoot({ cwd: nested });

    expect(found).toBe(vault);
    expect(root).toBe(vault);
  });

  it('given no project vault when resolve then falls back to home .kmind', async () => {
    const root = await resolveVaultRoot({ cwd: dir });
    expect(root).toBe(path.join(os.homedir(), '.kmind'));
  });

  it('given repo root when projectVaultPath then joins dirname', () => {
    expect(projectVaultPath(dir)).toBe(path.join(dir, PROJECT_VAULT_DIRNAME));
  });
});
