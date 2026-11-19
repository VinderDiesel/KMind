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

/** Test/fixture trees are excluded from the dig inventory (see bootstrap-rules). */
const TEST_DIR_NAMES = new Set([
  'test',
  'tests',
  '__tests__',
  'e2e',
  'fixtures',
  '__fixtures__',
]);

function isTestPath(rel: string): boolean {
  return rel
    .replace(/\\/g, '/')
    .split('/')
    .some((seg) => TEST_DIR_NAMES.has(seg));
}

export interface SelectModulesOptions {
  repoRoot: string;
  /** Max depth below repo root when walking (default 5). */
  maxDepth?: number;
  /**
   * Split source-heavy modules (default 400 files) into source-bearing subdirs.
   * Mainly for Java/Gradle repos where `src/main` holds thousands of files.
   * Set 0 to disable.
   */
  refineThreshold?: number;
}

/** Modules at or above this file count are refined into sub-modules. */
export const DEFAULT_REFINE_THRESHOLD = 400;

/** How many multi-child levels we may split before keeping the parent module. */
const MAX_REFINE_SPLIT_DEPTH = 3;

/** Guard against pathological symlink loops while walking single-child chains. */
const MAX_REFINE_WALK = 12;

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

  const threshold = options.refineThreshold ?? DEFAULT_REFINE_THRESHOLD;
  const refined =
    threshold > 0
      ? await refineOversizedModules(root, selected, threshold)
      : selected;

  refined.sort((a, b) => a.path.localeCompare(b.path));
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  return { selected: refined, excluded };
}

/**
 * Split oversized Java main-source modules into source-bearing package dirs.
 * Non-Java modules and small modules pass through untouched.
 */
async function refineOversizedModules(
  repoRoot: string,
  modules: BootstrapModule[],
  threshold: number,
): Promise<BootstrapModule[]> {
  const out: BootstrapModule[] = [];
  for (const mod of modules) {
    if ((mod.fileCount ?? 0) < threshold || !isJavaMainModule(mod.path)) {
      out.push(mod);
      continue;
    }
    const children = await descendJavaPackages(
      path.join(repoRoot, mod.path),
      mod.path,
      threshold,
      0,
    );
    if (children.length >= 2) out.push(...children);
    else out.push(mod);
  }
  return out;
}

/** True when the module path sits under `<...>/src/main` (Java/Gradle layout). */
export function isJavaMainModule(modulePath: string): boolean {
  return /(^|\/)src\/main(\/|$)/.test(modulePath.replace(/\\/g, '/'));
}

interface SourceChild {
  abs: string;
  rel: string;
  count: number;
}

async function descendJavaPackages(
  absDir: string,
  relDir: string,
  threshold: number,
  splitDepth: number,
): Promise<BootstrapModule[]> {
  let abs = absDir;
  let rel = relDir;
  let depth = splitDepth;
  for (let walk = 0; walk < MAX_REFINE_WALK; walk += 1) {
    const children = await listSourceChildren(abs, rel);
    if (children.length === 0) return [];
    if (children.length === 1) {
      // Package prefixes (com/acme/app/...) carry a single child — walk through
      // without spending split budget.
      const only = children[0]!;
      abs = only.abs;
      rel = only.rel;
      continue;
    }
    if (depth >= MAX_REFINE_SPLIT_DEPTH) return [];
    const out: BootstrapModule[] = [];
    for (const child of children) {
      if (child.count >= threshold) {
        const deeper = await descendJavaPackages(
          child.abs,
          child.rel,
          threshold,
          depth + 1,
        );
        if (deeper.length >= 2) {
          out.push(...deeper);
          continue;
        }
      }
      out.push({
        path: normalizeRel(child.rel),
        kind: 'dir',
        reason: 'selected',
        fileCount: child.count,
      });
    }
    return out;
  }
  return [];
}

async function listSourceChildren(
  absDir: string,
  relDir: string,
): Promise<SourceChild[]> {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const children: SourceChild[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.') || EXCLUDE_DIR_NAMES.has(ent.name)) continue;
    const abs = path.join(absDir, ent.name);
    const count = await countSourceFiles(abs, 8);
    if (count > 0) {
      children.push({ abs, rel: path.join(relDir, ent.name), count });
    }
  }
  return children;
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
    if (isTestPath(sub.rel)) {
      pushExcluded(excluded, seen, sub.rel, 'dir', 'test');
      continue;
    }
    // Java layouts bury sources under src/main/java/com/... — count deeper.
    const subCount = await countSourceFiles(sub.abs, 8);
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
