import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppContext } from '../context.js';
import { success, fail } from '../exit.js';
import { KMindError } from '@kmind/shared';

/** Terminal → skill directory under user home or project cwd. */
export const SKILL_TARGETS: Record<
  string,
  { globalDir: string; projectDir: string }
> = {
  cursor: {
    globalDir: path.join(os.homedir(), '.cursor', 'skills'),
    projectDir: path.join('.cursor', 'skills'),
  },
  'claude-code': {
    globalDir: path.join(os.homedir(), '.claude', 'skills'),
    projectDir: path.join('.claude', 'skills'),
  },
  codex: {
    globalDir: path.join(os.homedir(), '.codex', 'skills'),
    projectDir: path.join('.codex', 'skills'),
  },
  kiro: {
    globalDir: path.join(os.homedir(), '.kiro', 'skills'),
    projectDir: path.join('.kiro', 'skills'),
  },
  qoder: {
    globalDir: path.join(os.homedir(), '.qoder', 'skills'),
    projectDir: path.join('.qoder', 'skills'),
  },
};

export interface SkillInstallResult {
  skill: string;
  terminal: string;
  scope: 'global' | 'project';
  targetPath: string;
}

/**
 * Resolve bundled skill pack root (`…/skills` containing `kmind-capture/`).
 */
export async function findSkillsPackRoot(): Promise<string> {
  const start = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // packages/cli/skills (shipped next to package)
    path.resolve(start, '..', '..', 'skills'),
    // dist → ../skills during some layouts
    path.resolve(start, '..', 'skills'),
    // Monorepo root skills/
    path.resolve(start, '..', '..', '..', '..', 'skills'),
  ];
  for (const abs of candidates) {
    try {
      await fs.access(path.join(abs, 'kmind-capture', 'SKILL.md'));
      return abs;
    } catch {
      /* try next */
    }
  }
  throw new KMindError('KMind skill pack not found (skills/kmind-capture)', {
    category: 'ADAPTER_ERROR',
    severity: 'medium',
    retryable: false,
    suggestion:
      'Run from a KMind checkout after build, or ensure packages/cli/skills is present',
  });
}

/**
 * List skill names in the pack.
 */
export async function listBundledSkills(): Promise<string[]> {
  const root = await findSkillsPackRoot();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const names: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      await fs.access(path.join(root, e.name, 'SKILL.md'));
      names.push(e.name);
    } catch {
      /* skip */
    }
  }
  return names.sort();
}

/**
 * Copy one skill directory into a terminal skills root.
 */
export async function installSkillToTarget(
  skillName: string,
  skillsRoot: string,
  packRoot: string,
): Promise<string> {
  const src = path.join(packRoot, skillName);
  const dest = path.join(skillsRoot, skillName);
  await fs.access(path.join(src, 'SKILL.md'));
  await copyDir(src, dest);
  return dest;
}

/**
 * Install bundled skills for one or all terminals.
 * Default scope is global (`~/.<tool>/skills`) so skills work in any project.
 */
export async function cmdSkillsInstall(
  ctx: AppContext,
  options: {
    name?: string;
    all?: boolean;
    project?: boolean;
    cwd?: string;
  },
): Promise<void> {
  const scope: 'global' | 'project' = options.project ? 'project' : 'global';
  const cwd = options.cwd ?? process.cwd();

  let packRoot: string;
  let skills: string[];
  try {
    packRoot = await findSkillsPackRoot();
    skills = await listBundledSkills();
  } catch (err) {
    fail(err, ctx.json);
    return;
  }

  if (skills.length === 0) {
    fail(
      new KMindError('No bundled skills found', {
        category: 'ADAPTER_ERROR',
        severity: 'medium',
        retryable: false,
        suggestion: 'Ensure skills/kmind-capture/SKILL.md exists in the pack',
      }),
      ctx.json,
    );
    return;
  }

  let terminals: string[];
  try {
    terminals = resolveTerminals(options);
  } catch (err) {
    fail(err, ctx.json);
    return;
  }

  const installed: SkillInstallResult[] = [];
  for (const terminal of terminals) {
    const mapping = SKILL_TARGETS[terminal];
    if (!mapping) {
      fail(
        new KMindError(`No skill target for terminal: ${terminal}`, {
          category: 'ADAPTER_ERROR',
          severity: 'medium',
          retryable: false,
          suggestion: `Supported: ${Object.keys(SKILL_TARGETS).join(', ')}`,
        }),
        ctx.json,
      );
      return;
    }
    const skillsRoot =
      scope === 'global'
        ? mapping.globalDir
        : path.join(cwd, mapping.projectDir);
    await fs.mkdir(skillsRoot, { recursive: true });
    for (const skill of skills) {
      const targetPath = await installSkillToTarget(skill, skillsRoot, packRoot);
      installed.push({ skill, terminal, scope, targetPath });
    }
  }

  success(
    {
      installed: true,
      scope,
      count: installed.length,
      results: installed,
      hint:
        scope === 'global'
          ? 'Restart the AI terminal (or /reload-skills) so skills load.'
          : 'Commit project skills to share with the team; restart agent session.',
    },
    ctx.json,
  );
}

/**
 * List bundled skills and per-terminal install paths.
 */
export async function cmdSkillsList(ctx: AppContext): Promise<void> {
  try {
    const skills = await listBundledSkills();
    const targets = Object.entries(SKILL_TARGETS).map(([name, t]) => ({
      name,
      globalDir: t.globalDir,
      projectDir: t.projectDir,
    }));
    success({ skills, targets }, ctx.json);
  } catch (err) {
    fail(err, ctx.json);
  }
}

/**
 * Install skills for a single adapter name (used by adapters install).
 */
export async function installSkillsForAdapter(
  adapterName: string,
  options?: { project?: boolean; cwd?: string },
): Promise<SkillInstallResult[]> {
  const scope: 'global' | 'project' = options?.project ? 'project' : 'global';
  const cwd = options?.cwd ?? process.cwd();
  const mapping = SKILL_TARGETS[adapterName];
  if (!mapping) return [];

  const packRoot = await findSkillsPackRoot();
  const skills = await listBundledSkills();
  const skillsRoot =
    scope === 'global' ? mapping.globalDir : path.join(cwd, mapping.projectDir);
  await fs.mkdir(skillsRoot, { recursive: true });

  const installed: SkillInstallResult[] = [];
  for (const skill of skills) {
    const targetPath = await installSkillToTarget(skill, skillsRoot, packRoot);
    installed.push({ skill, terminal: adapterName, scope, targetPath });
  }
  return installed;
}

function resolveTerminals(options: {
  name?: string;
  all?: boolean;
}): string[] {
  if (options.all) return Object.keys(SKILL_TARGETS);
  if (options.name) {
    if (!(options.name in SKILL_TARGETS)) {
      throw new KMindError(`Unknown terminal for skills: ${options.name}`, {
        category: 'ADAPTER_ERROR',
        severity: 'medium',
        retryable: false,
        suggestion: `Use one of: ${Object.keys(SKILL_TARGETS).join(', ')} or --all`,
      });
    }
    return [options.name];
  }
  throw new KMindError('Specify a terminal name or --all', {
    category: 'ADAPTER_ERROR',
    severity: 'medium',
    retryable: false,
    suggestion: 'kmind skills install cursor | kmind skills install --all',
  });
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}
