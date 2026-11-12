import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Project-scoped vault directory name (committed under the git repo). */
export const PROJECT_VAULT_DIRNAME = '.kmind-knowledge';

export interface ResolveVaultRootOptions {
  /** Explicit `--vault` path; wins over discovery. */
  explicit?: string;
  /** Start directory for upward search (default: process.cwd()). */
  cwd?: string;
}

/**
 * Resolve vault root: explicit path → nearest `.kmind-knowledge/` → `~/.kmind`.
 */
export async function resolveVaultRoot(
  options: ResolveVaultRootOptions = {},
): Promise<string> {
  if (options.explicit !== undefined && options.explicit !== '') {
    return path.resolve(options.explicit);
  }
  const cwd = options.cwd ?? process.cwd();
  const project = await findProjectVault(cwd);
  if (project) return project;
  return path.join(os.homedir(), '.kmind');
}

/**
 * Walk upward from cwd looking for `.kmind-knowledge/config.yaml`.
 */
export async function findProjectVault(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, PROJECT_VAULT_DIRNAME);
    try {
      await fs.access(path.join(candidate, 'config.yaml'));
      return candidate;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Path where `kmind init --project` should create the vault (repo root + dirname).
 */
export function projectVaultPath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), PROJECT_VAULT_DIRNAME);
}
