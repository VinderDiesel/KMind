import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  accessSync,
  constants,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installProjectGitHooks, PROJECT_HOOKS_DIRNAME } from './project-hooks.js';

describe('installProjectGitHooks', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-hooks-'));
    const init = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
    if (init.status !== 0) {
      mkdirSync(path.join(dir, '.git'), { recursive: true });
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given repo dir when install then writes executable hooks', async () => {
    const result = await installProjectGitHooks(dir);
    expect(result.files).toHaveLength(3);
    expect(existsSync(path.join(dir, PROJECT_HOOKS_DIRNAME, 'pre-commit'))).toBe(
      true,
    );
    accessSync(
      path.join(dir, PROJECT_HOOKS_DIRNAME, 'pre-commit'),
      constants.X_OK,
    );
    expect(
      result.hooksPathConfigured || result.warnings.length > 0,
    ).toBe(true);
  });
});
