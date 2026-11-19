import { promises as fs } from 'node:fs';
import path from 'node:path';

const SKIP_DIR_NAMES = new Set([
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

const SKIP_DIR_SEGMENTS = new Set([
  'test',
  'tests',
  '__tests__',
  'e2e',
  'fixtures',
  '__fixtures__',
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

const DOC_EXT = new Set(['.md', '.mdx']);
const CONFIG_FILES = new Set(['package.json', 'pyproject.toml', 'go.mod']);

export interface ModuleEvidenceFile {
  /** Repo-relative path with forward slashes. */
  path: string;
  content: string;
  truncated: boolean;
}

export interface ModuleEvidence {
  modulePaths: string[];
  files: ModuleEvidenceFile[];
  exports: Array<{ file: string; symbols: string[] }>;
  headings: Array<{ file: string; heading: string }>;
  totalChars: number;
  skippedPaths: string[];
}

export interface CollectModuleEvidenceOptions {
  repoRoot: string;
  paths: string[];
  /** Total evidence character budget (default 24000). */
  maxChars?: number;
  /** Files included at most (default derived from budget). */
  maxFiles?: number;
  /** Per-file character cap (default 6000). */
  maxFileChars?: number;
}

/**
 * Deterministically collect bounded source/doc evidence for an LLM dig.
 * Tests/fixtures and generated dirs are skipped to keep the prompt on task.
 */
export async function collectModuleEvidence(
  options: CollectModuleEvidenceOptions,
): Promise<ModuleEvidence> {
  const repoRoot = path.resolve(options.repoRoot);
  const maxChars = options.maxChars ?? 24_000;
  const maxFiles =
    options.maxFiles ??
    Math.max(4, Math.min(16, Math.floor(maxChars / 4_000)));
  const maxFileChars = options.maxFileChars ?? 6_000;

  const skippedPaths: string[] = [];
  const candidates: Array<{ abs: string; rel: string; rank: number }> = [];
  for (const relInput of options.paths) {
    const rel = normalizeRel(relInput);
    const abs = path.join(repoRoot, relInput || '.');
    const stat = await statSafe(abs);
    if (!stat) {
      skippedPaths.push(rel);
      continue;
    }
    if (stat.isFile()) {
      candidates.push({ abs, rel, rank: rankOf(rel) });
      continue;
    }
    await walk(abs, rel, candidates, skippedPaths);
  }

  candidates.sort((a, b) => a.rank - b.rank || a.rel.localeCompare(b.rel));
  const picked = candidates.slice(0, maxFiles);

  const files: ModuleEvidenceFile[] = [];
  const exports: ModuleEvidence['exports'] = [];
  const headings: ModuleEvidence['headings'] = [];
  let totalChars = 0;

  for (const candidate of picked) {
    if (totalChars >= maxChars) break;
    let raw: string;
    try {
      raw = await fs.readFile(candidate.abs, 'utf8');
    } catch {
      skippedPaths.push(candidate.rel);
      continue;
    }
    const remaining = maxChars - totalChars;
    const cap = Math.min(maxFileChars, remaining);
    const truncated = raw.length > cap;
    const content = truncated ? raw.slice(0, cap) : raw;
    totalChars += content.length;
    files.push({ path: candidate.rel, content, truncated });
    exports.push({
      file: candidate.rel,
      symbols: extractExportSymbols(content),
    });
    for (const heading of extractHeadings(content)) {
      headings.push({ file: candidate.rel, heading });
    }
  }

  return {
    modulePaths: options.paths.map(normalizeRel),
    files,
    exports: exports.filter((e) => e.symbols.length > 0),
    headings: headings.slice(0, 80),
    totalChars,
    skippedPaths,
  };
}

async function walk(
  absDir: string,
  relDir: string,
  out: Array<{ abs: string; rel: string; rank: number }>,
  skippedPaths: string[],
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    skippedPaths.push(relDir);
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const rel = relDir === '.' ? ent.name : `${relDir}/${ent.name}`;
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name) || SKIP_DIR_SEGMENTS.has(ent.name)) {
        continue;
      }
      await walk(path.join(absDir, ent.name), rel, out, skippedPaths);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!isEvidenceFile(ent.name)) continue;
    out.push({
      abs: path.join(absDir, ent.name),
      rel,
      rank: rankOf(rel),
    });
  }
}

function isEvidenceFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  if (SOURCE_EXT.has(ext) || DOC_EXT.has(ext)) {
    return !/\.(test|spec)\.[jt]sx?$/.test(name) && !name.endsWith('.d.ts');
  }
  return CONFIG_FILES.has(name);
}

/** Lower rank = read earlier (entrypoints and docs first). */
function rankOf(rel: string): number {
  const base = path.basename(rel).toLowerCase();
  if (/^index\.[a-z]+$/.test(base)) return 0;
  if (/^main\.[a-z]+$/.test(base)) return 1;
  if (base.startsWith('readme')) return 2;
  if (base === 'package.json' || base === 'pyproject.toml' || base === 'go.mod') {
    return 3;
  }
  if (base.endsWith('.md') || base.endsWith('.mdx')) return 4;
  return 5;
}

/** Exported symbols used for anchor hints and the prompt. */
export function extractExportSymbols(text: string): string[] {
  const out = new Set<string>();
  const named = /export\s+(?:async\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(named)) {
    if (match[1]) out.add(match[1]);
  }
  const grouped = /export\s*\{([^}]+)\}/g;
  for (const match of text.matchAll(grouped)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) out.add(name);
    }
  }
  const pythonDef = /^(?:async\s+)?def\s+([A-Za-z_]\w*)|^class\s+([A-Za-z_]\w*)/gm;
  for (const match of text.matchAll(pythonDef)) {
    const name = match[1] ?? match[2];
    if (name && !name.startsWith('_')) out.add(name);
  }
  return [...out].slice(0, 40);
}

function extractHeadings(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    const heading = (match[1] ?? '').trim();
    if (heading) out.push(heading);
  }
  return out.slice(0, 20);
}

function normalizeRel(value: string): string {
  if (!value || value === '.') return '.';
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function statSafe(abs: string) {
  try {
    return await fs.stat(abs);
  } catch {
    return null;
  }
}
