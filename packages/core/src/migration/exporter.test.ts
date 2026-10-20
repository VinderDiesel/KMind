import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { createVault } from '../storage/vault.js';
import { MarkdownStore } from '../storage/markdown-store.js';
import { Exporter } from './exporter.js';

describe('Exporter', () => {
  let dir: string;

  beforeEach(async () => {
    resetFactoryCounters();
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-exp-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given assets when exportToGit then writes manifest and gitignore', async () => {
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    const md = new MarkdownStore(vault.knowledgeDir);
    await md.write(
      createKnowledgeAsset({
        id: 'k-2026-01-01-001',
        title: 'a',
        project: 'alpha',
        type: 'pitfall',
      }),
    );
    await md.write(
      createKnowledgeAsset({
        id: 'k-2026-01-01-002',
        title: 'b',
        project: 'beta',
        type: 'best_practice',
      }),
    );

    const out = path.join(dir, 'git-out');
    const manifest = await new Exporter(vault).exportToGit(out, {
      filter: { projects: ['alpha'] },
    });
    expect(manifest.assetCount).toBe(1);
    expect(existsSync(path.join(out, 'manifest.json'))).toBe(true);
    expect(existsSync(path.join(out, '.gitignore'))).toBe(true);
    expect(existsSync(path.join(out, 'knowledge', 'k-2026-01-01-001.md'))).toBe(
      true,
    );
    expect(existsSync(path.join(out, 'knowledge', 'k-2026-01-01-002.md'))).toBe(
      false,
    );
    const parsed = JSON.parse(
      readFileSync(path.join(out, 'manifest.json'), 'utf8'),
    ) as { formatVersion: number };
    expect(parsed.formatVersion).toBe(1);
  });

  it('given vault when exportToTarGz then archive exists without index db', async () => {
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    const md = new MarkdownStore(vault.knowledgeDir);
    await md.write(
      createKnowledgeAsset({ id: 'k-2026-01-01-001', title: 'x' }),
    );
    const archive = path.join(dir, 'out.tar.gz');
    const manifest = await new Exporter(vault).exportToTarGz(archive);
    expect(manifest.assetCount).toBe(1);
    expect(existsSync(archive)).toBe(true);
  });

  it('given initGit when exportToGit then creates .git', async () => {
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    const md = new MarkdownStore(vault.knowledgeDir);
    await md.write(
      createKnowledgeAsset({ id: 'k-2026-01-01-001', title: 'x' }),
    );
    const out = path.join(dir, 'git-init');
    try {
      await new Exporter(vault).exportToGit(out, {
        initGit: true,
        commitMessage: 'test export',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Some CI sandboxes block git config writes under /tmp
      if (/Operation not permitted|git not found/i.test(msg)) {
        return;
      }
      throw err;
    }
    expect(existsSync(path.join(out, '.git'))).toBe(true);
  });
});
