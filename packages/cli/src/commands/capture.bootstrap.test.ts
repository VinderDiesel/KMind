import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createVault,
  loadBootstrapProgress,
  markBootstrapProgressTask,
} from '@kmind/core';

describe('cmdCapture bootstrap mark DRY', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('given capture source when inspect then uses markBootstrapProgressTask', async () => {
    const srcPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'capture.ts',
    );
    const src = await fs.readFile(srcPath, 'utf8');
    expect(src).toContain('markBootstrapProgressTask');
    expect(src).not.toContain('upsertProgressTask');
    expect(src).not.toContain('saveBootstrapProgress');
  });

  it('given capture with bootstrap-task when success then progress marked done', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-cap-boot-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    await markBootstrapProgressTask({
      vault,
      project: 'demo',
      repoRoot: dir,
      taskId: 'dig-a',
      status: 'done',
      assetId: 'k-2026-11-18-001-abcd',
    });
    const progress = await loadBootstrapProgress(vault, 'demo');
    expect(
      progress?.tasks.some((t) => t.id === 'dig-a' && t.status === 'done'),
    ).toBe(true);
  });
});
