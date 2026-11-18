import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BootstrapModule } from '@kmind/shared';

const EXCLUDE_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.svn',
  '.hg',
  '.next',
  '.turbo',
  '.cache',
  '.kmind-knowledge',
  'raw',
  'vendor',
  'target',
  '__pycache__',
  '.venv',
  'venv',
]);

const SOURCE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.go',
  '.py',
  '.rs',
  '.java',
  '.kt',
  '.kts',
]);

export interface SelectModulesOptions {
  repoRoot: string;
  /** Max depth below repo root when walking (default 5). */
  maxDepth?: number;
}

export interface SelectModulesResult {
  selected: BootstrapModule[];
  excluded: BootstrapModule[];
}

/**
 * Deterministic inventory of reviewable modules (packages / src dirs).
 */
export async function selectModules(
  options: SelectModulesOptions,
): Promise<SelectModulesResult> {
  const root = path.resolve(options.repoRoot);
  const maxDepth = options.maxDepth ?? 5;
  const selected: BootstrapModule[] = [];
  const excluded: BootstrapModule[] = [];
  const seen = new Set<string>();

  const packagesDir = path.join(root, 'packages');
  if (await isDir(packagesDir)) {
    const entries = await fs.readdir(packagesDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (EXCLUDE_DIR_NAMES.has(ent.name)) {
        pushExcluded(excluded, seen, path.join('packages', ent.name), 'dir', 'noise');
        continue;
      }
      const rel = path.join('packages', ent.name);
      const abs = path.join(packagesDir, ent.name);
      await markNoiseSiblings(abs, rel, excluded, seen);
      const srcAbs = path.join(abs, 'src');
      if (await isDir(srcAbs)) {
        // Keep `…/src/…` in module paths so dig anchors resolve on disk.
        await collectUnder(
          root,
          srcAbs,
          path.join(rel, 'src'),
          maxDepth,
          selected,
          excluded,
          seen,
        );
      } else {
        const count = await countSourceFiles(abs, 3);
        if (count === 0) {
          pushExcluded(excluded, seen, rel, 'package', 'no_source');
        } else {
          pushSelected(selected, seen, rel, 'package', count);
        }
      }
    }
  }

  const rootSrc = path.join(root, 'src');
  if (await isDir(rootSrc)) {
    await collectUnder(root, rootSrc, 'src', maxDepth, selected, excluded, seen);
  }

  // Monorepo apps/ or services/
  for (const top of ['apps', 'services', 'internal', 'cmd']) {
    const abs = path.join(root, top);
    if (!(await isDir(abs))) continue;
    await collectUnder(root, abs, top, maxDepth, selected, excluded, seen);
  }

  if (selected.length === 0) {
    // Flat repo: treat root as one module if it has source files.
    const count = await countSourceFiles(root, 2);
    if (count > 0) {
      pushSelected(selected, seen, '.', 'dir', count);
    }
  }

  selected.sort((a, b) => a.path.localeCompare(b.path));
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  return { selected, excluded };
}

async function collectUnder(
  repoRoot: string,
  absDir: string,
  relBase: string,
  maxDepth: number,
  selected: BootstrapModule[],
  excluded: BootstrapModule[],
  seen: Set<string>,
): Promise<void> {
  const depthFromRoot = relBase === '.' ? 0 : relBase.split(path.sep).length;
  if (depthFromRoot > maxDepth) return;

  const entries = await fs.readdir(absDir, { withFileTypes: true });
  let immediateSource = 0;
  const subDirs: { name: string; abs: string; rel: string }[] = [];

  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.github') continue;
    if (EXCLUDE_DIR_NAMES.has(ent.name)) {
      pushExcluded(
        excluded,
        seen,
        path.join(relBase, ent.name),
        'dir',
        'noise',
      );
      continue;
    }
    const abs = path.join(absDir, ent.name);
    const rel = path.join(relBase, ent.name);
    if (ent.isDirectory()) {
      subDirs.push({ name: ent.name, abs, rel });
    } else if (ent.isFile() && SOURCE_EXT.has(path.extname(ent.name))) {
      immediateSource += 1;
    }
  }

  // Prefer one module per meaningful subdirectory (storage, compiler, …).
  let usedSub = false;
  for (const sub of subDirs) {
    const subCount = await countSourceFiles(sub.abs, 3);
    if (subCount === 0) {
      pushExcluded(excluded, seen, sub.rel, 'dir', 'no_source');
      continue;
    }
    // Nest one more level for packages/*/src/<module>
    if (
      relBase.includes(`${path.sep}src`) ||
      relBase.endsWith(`${path.sep}src`) ||
      relBase === 'src'
    ) {
      pushSelected(selected, seen, sub.rel, 'dir', subCount);
      usedSub = true;
    } else if (sub.name === 'src') {
      await collectUnder(
        repoRoot,
        sub.abs,
        sub.rel,
        maxDepth,
        selected,
        excluded,
        seen,
      );
      usedSub = true;
    } else {
      pushSelected(selected, seen, sub.rel, 'dir', subCount);
      usedSub = true;
    }
  }

  if (!usedSub && immediateSource > 0) {
    pushSelected(selected, seen, relBase, 'dir', immediateSource);
  }
}

function pushSelected(
  selected: BootstrapModule[],
  seen: Set<string>,
  rel: string,
  kind: BootstrapModule['kind'],
  fileCount: number,
): void {
  const norm = normalizeRel(rel);
  if (seen.has(norm)) return;
  seen.add(norm);
  selected.push({
    path: norm,
    kind,
    reason: 'selected',
    fileCount,
  });
}

function pushExcluded(
  excluded: BootstrapModule[],
  seen: Set<string>,
  rel: string,
  kind: BootstrapModule['kind'],
  excludeReason: string,
): void {
  const norm = normalizeRel(rel);
  const key = `ex:${norm}`;
  if (seen.has(key) || seen.has(norm)) return;
  seen.add(key);
  excluded.push({
    path: norm,
    kind,
    reason: 'excluded',
    excludeReason,
  });
}

function normalizeRel(rel: string): string {
  if (rel === '.' || rel === '') return '.';
  return rel.split(path.sep).join('/');
}

async function isDir(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** Record package-local noise dirs (node_modules/dist) even when we only walk src/. */
async function markNoiseSiblings(
  packageAbs: string,
  packageRel: string,
  excluded: BootstrapModule[],
  seen: Set<string>,
): Promise<void> {
  for (const name of EXCLUDE_DIR_NAMES) {
    const abs = path.join(packageAbs, name);
    if (await isDir(abs)) {
      pushExcluded(
        excluded,
        seen,
        path.join(packageRel, name),
        'dir',
        'noise',
      );
    }
  }
}

async function countSourceFiles(dir: string, maxDepth: number): Promise<number> {
  let count = 0;
  async function walk(abs: string, depth: number): Promise<void> {
    if (depth > maxDepth || count > 500) return;
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (EXCLUDE_DIR_NAMES.has(ent.name)) continue;
      if (ent.name.startsWith('.') && ent.name !== '.github') continue;
      const child = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        await walk(child, depth + 1);
      } else if (SOURCE_EXT.has(path.extname(ent.name))) {
        count += 1;
      }
    }
  }
  await walk(dir, 0);
  return count;
}
