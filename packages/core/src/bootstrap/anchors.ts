import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DigTaskSuggestedAnchor } from '@kmind/shared';
import type { CodegraphClient } from '../codegraph/types.js';

const ENTRY_FILES = ['index.ts', 'index.js', 'index.mjs', 'main.go', 'mod.rs', 'main.ts'];

/**
 * Enrich suggested anchors: prefer real export symbols; optionally verify via Codegraph.
 */
export async function enrichSuggestedAnchors(
  repoRoot: string,
  modulePath: string,
  codegraph?: CodegraphClient,
): Promise<DigTaskSuggestedAnchor[]> {
  const rel = modulePath.replace(/\\/g, '/');
  if (rel === '.') {
    return [];
  }

  const entryRel = await findEntryFile(repoRoot, rel);
  if (!entryRel) {
    return [{ file: `${rel}/index.ts` }];
  }

  const abs = path.join(repoRoot, entryRel);
  let symbols: string[] = [];
  try {
    const text = await fs.readFile(abs, 'utf8');
    symbols = extractExportNames(text).slice(0, 5);
  } catch {
    return [{ file: entryRel }];
  }

  if (symbols.length === 0) {
    return [{ file: entryRel }];
  }

  const anchors: DigTaskSuggestedAnchor[] = [];
  if (codegraph) {
    const available = await codegraph.isAvailable(repoRoot).catch(() => false);
    if (available) {
      for (const symbol of symbols) {
        const hit = await codegraph
          .findSymbol({ projectPath: repoRoot, symbol, file: entryRel })
          .catch(() => ({ found: false, matches: [] }));
        if (hit.found) {
          anchors.push({ file: entryRel, symbol });
        }
      }
    }
  }

  if (anchors.length === 0) {
    return symbols.slice(0, 3).map((symbol) => ({ file: entryRel, symbol }));
  }
  return anchors;
}

async function findEntryFile(
  repoRoot: string,
  moduleRel: string,
): Promise<string | null> {
  for (const name of ENTRY_FILES) {
    const rel = path.posix.join(moduleRel, name);
    try {
      await fs.access(path.join(repoRoot, rel));
      return rel;
    } catch {
      /* try next */
    }
  }
  // First .ts file in directory
  try {
    const abs = path.join(repoRoot, moduleRel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const ts = entries.find(
      (e) => e.isFile() && /\.(ts|tsx|js|mjs)$/.test(e.name) && !e.name.includes('.test.'),
    );
    if (ts) return path.posix.join(moduleRel, ts.name);
  } catch {
    /* ignore */
  }
  return null;
}

/** Extract exported identifiers from a source file (heuristic). */
export function extractExportNames(source: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_][\w]*)/g,
    /export\s+class\s+([A-Za-z_][\w]*)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z_][\w]*)/g,
    /export\s+(?:type|interface)\s+([A-Za-z_][\w]*)/g,
    /export\s+\{\s*([^}]+)\s*\}/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      if (re.source.includes('{')) {
        const parts = (m[1] ?? '').split(',');
        for (const part of parts) {
          const id = part
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim();
          if (id && /^[A-Za-z_][\w]*$/.test(id) && !seen.has(id)) {
            seen.add(id);
            names.push(id);
          }
        }
      } else {
        const id = m[1];
        if (id && !seen.has(id)) {
          seen.add(id);
          names.push(id);
        }
      }
    }
  }
  return names;
}
