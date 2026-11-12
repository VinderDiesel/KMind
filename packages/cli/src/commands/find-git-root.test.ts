import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findGitRoot } from './find-git-root.js';

describe('findGitRoot', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-git-root-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given nested dir under .git when find then returns repo root', async () => {
    mkdirSync(path.join(dir, '.git'));
    const nested = path.join(dir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(await findGitRoot(nested)).toBe(dir);
  });

  it('given no .git when find then returns null', async () => {
    expect(await findGitRoot(dir)).toBeNull();
  });

  it('given file named .git when find then still treats as root', async () => {
    writeFileSync(path.join(dir, '.git'), 'gitdir: ../elsewhere\n', 'utf8');
    expect(await findGitRoot(dir)).toBe(dir);
  });
});
