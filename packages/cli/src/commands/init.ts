import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createVault,
  projectVaultPath,
  PROJECT_VAULT_DIRNAME,
  SqliteStore,
} from '@kmind/core';
import { KMindError } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';
import { ensureProjectFeatureTree } from './feature-tree.js';
import { findGitRoot } from './find-git-root.js';
import { installProjectAgentContext } from './project-context.js';
import { installProjectGitHooks } from './project-hooks.js';

const PROJECT_VAULT_GITIGNORE = [
  '# Local-only (never commit)',
  'index.db',
  'index.db-*',
  'raw/',
  'audit/',
  'diagnostics/',
  'run/',
  'logs/',
  '.kmind-import-*/',
  '.DS_Store',
  '',
].join('\n');

export interface InitOptions {
  /** Create `.kmind-knowledge/` in the git repo and wire team sharing. */
  project?: boolean;
  cwd?: string;
}

/**
 * Initialize a vault directory (home or project-scoped).
 */
export async function cmdInit(
  ctx: AppContext,
  options: InitOptions = {},
): Promise<void> {
  if (options.project) {
    await initProjectVault(ctx.json, options.cwd ?? process.cwd());
    return;
  }
  await ctx.vault.init();
  await ctx.store.migrate();
  success(
    {
      ok: true,
      vaultPath: ctx.vault.root,
      message: `Initialized vault at ${ctx.vault.root}`,
    },
    ctx.json,
  );
}

async function initProjectVault(json: boolean, cwd: string): Promise<void> {
  const repoRoot = await findGitRoot(cwd);
  if (!repoRoot) {
    throw new KMindError('Not inside a git repository', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: false,
      suggestion: 'Run `git init` or cd into a clone, then `kmind init --project`',
    });
  }

  const vaultPath = projectVaultPath(repoRoot);
  const vault = createVault(vaultPath);
  await vault.init();
  const store = new SqliteStore(vault.indexPath);
  try {
    await store.migrate();
  } finally {
    store.close();
  }

  await fs.writeFile(
    path.join(vaultPath, '.gitignore'),
    PROJECT_VAULT_GITIGNORE,
    'utf8',
  );

  const featureTree = await ensureProjectFeatureTree(vaultPath);
  const agentContext = await installProjectAgentContext(repoRoot);
  const hooks = await installProjectGitHooks(repoRoot);

  success(
    {
      ok: true,
      mode: 'project',
      repoRoot,
      vaultPath,
      vaultDirname: PROJECT_VAULT_DIRNAME,
      featureTree,
      agentContext,
      hooks,
      message: `Initialized project vault at ${vaultPath}. Maintain ${path.join(PROJECT_VAULT_DIRNAME, 'FEATURE_TREE.md')}; commit shared vault paths + AGENTS.md + .githooks/; restart AI terminals.`,
    },
    json,
  );
}
