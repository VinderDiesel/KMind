import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KMindError } from '@kmind/shared';

export const PROJECT_HOOKS_DIRNAME = '.githooks';

export interface ProjectHooksInstallResult {
  hooksDir: string;
  hooksPathConfigured: boolean;
  files: string[];
  warnings: string[];
}

/**
 * Resolve bundled `templates/project-hooks/`.
 */
export async function findProjectHooksTemplateRoot(): Promise<string> {
  const start = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(start, '..', '..', '..', '..', 'templates', 'project-hooks'),
    path.resolve(start, '..', '..', 'templates', 'project-hooks'),
    path.resolve(start, '..', 'templates', 'project-hooks'),
  ];
  for (const abs of candidates) {
    try {
      await fs.access(path.join(abs, 'pre-commit'));
      return abs;
    } catch {
      /* try next */
    }
  }
  throw new KMindError('project-hooks templates not found', {
    category: 'ADAPTER_ERROR',
    severity: 'medium',
    retryable: false,
    suggestion:
      'Ensure templates/project-hooks/pre-commit exists in the KMind checkout',
  });
}

/**
 * Copy KMind git hooks into `<repo>/.githooks` and set local `core.hooksPath`.
 */
export async function installProjectGitHooks(
  repoRoot: string,
): Promise<ProjectHooksInstallResult> {
  const templateRoot = await findProjectHooksTemplateRoot();
  const hooksDir = path.join(repoRoot, PROJECT_HOOKS_DIRNAME);
  await fs.mkdir(hooksDir, { recursive: true });

  const names = ['pre-commit', 'post-merge', 'post-checkout'];
  const files: string[] = [];
  for (const name of names) {
    const dest = path.join(hooksDir, name);
    await fs.copyFile(path.join(templateRoot, name), dest);
    await fs.chmod(dest, 0o755);
    files.push(dest);
  }

  const warnings: string[] = [];
  let hooksPathConfigured = false;
  const cfg = spawnSync(
    'git',
    ['config', '--local', 'core.hooksPath', PROJECT_HOOKS_DIRNAME],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (cfg.status === 0) {
    hooksPathConfigured = true;
  } else {
    warnings.push(
      `git config core.hooksPath failed: ${(cfg.stderr || cfg.stdout || '').trim() || 'unknown'}`,
    );
  }

  return { hooksDir, hooksPathConfigured, files, warnings };
}
