import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveBootstrapRepo } from './bootstrap.js';

describe('resolveBootstrapRepo', () => {
  it('given explicit repo when resolve then uses absolute path', () => {
    const ctx = {
      vault: { root: '/tmp/vault/.kmind-knowledge' },
    } as Parameters<typeof resolveBootstrapRepo>[0];
    const got = resolveBootstrapRepo(ctx, '/tmp/code');
    expect(got).toBe(path.resolve('/tmp/code'));
  });

  it('given project vault when resolve then uses parent as code root', () => {
    const ctx = {
      vault: { root: '/tmp/proj/.kmind-knowledge' },
    } as Parameters<typeof resolveBootstrapRepo>[0];
    expect(resolveBootstrapRepo(ctx)).toBe(path.resolve('/tmp/proj'));
  });
});
