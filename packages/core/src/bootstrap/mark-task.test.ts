import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVault } from '../storage/vault.js';
import { loadBootstrapProgress } from './progress.js';
import { markBootstrapProgressTask } from './mark-task.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('markBootstrapProgressTask', () => {
  it('given empty audit when mark done then persists task status and assetId', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-mark-'));
    tmpDirs.push(dir);
    const vault = createVault(path.join(dir, 'vault'));
    await fs.mkdir(vault.auditDir, { recursive: true });

    const result = await markBootstrapProgressTask({
      vault,
      project: 'demo',
      repoRoot: '/repo',
      taskId: 'dig-a',
      status: 'done',
      assetId: 'k-2026-11-18-001-abcd',
    });

    expect(result.progress.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dig-a',
          status: 'done',
          assetId: 'k-2026-11-18-001-abcd',
        }),
      ]),
    );
    const again = await loadBootstrapProgress(vault, 'demo');
    expect(again?.tasks[0]?.status).toBe('done');
    expect(again?.tasks[0]?.assetId).toBe('k-2026-11-18-001-abcd');
  });
});
