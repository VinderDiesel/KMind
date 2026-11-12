import fs from 'node:fs';
import path from 'node:path';
import type { CodeAnchor } from '@kmind/shared';
import { readCodeAnchors, extractCodeAnchors } from '../compiler/code-anchors.js';
import type { KnowledgeAsset } from '@kmind/shared';

/** Default file-existence probe (injectable in tests). */
export function defaultFileExists(absPath: string): boolean {
  try {
    return fs.existsSync(absPath);
  } catch {
    return false;
  }
}

/**
 * Resolve candidate absolute paths for an anchor file.
 * Order: projectPath → codeRoot → cwd (first existing wins at check time).
 */
export function resolveAnchorPathCandidates(
  file: string,
  opts: {
    projectPath?: string;
    codeRoot?: string;
    cwd?: string;
  },
): string[] {
  const trimmed = file.trim();
  if (!trimmed) return [];
  if (path.isAbsolute(trimmed)) return [trimmed];

  const cwd = opts.cwd?.trim() || process.cwd();
  const out: string[] = [];
  const push = (root: string | undefined) => {
    const r = root?.trim();
    if (!r) return;
    out.push(path.join(path.resolve(r), trimmed));
  };

  push(opts.projectPath);
  push(opts.codeRoot);
  push(cwd);

  return [...new Set(out)];
}

/**
 * True when any candidate path exists.
 */
export function anchorFileExists(
  file: string,
  opts: {
    projectPath?: string;
    codeRoot?: string;
    cwd?: string;
    exists?: (absPath: string) => boolean;
  },
): boolean {
  const exists = opts.exists ?? defaultFileExists;
  const candidates = resolveAnchorPathCandidates(file, opts);
  if (candidates.length === 0) return false;
  return candidates.some((p) => exists(p));
}

/**
 * Collect anchors from metadata and body for fs checks.
 */
export function collectAssetAnchors(asset: KnowledgeAsset): CodeAnchor[] {
  const fromMeta = readCodeAnchors(asset.metadata);
  if (fromMeta.length > 0) return fromMeta;
  return extractCodeAnchors(asset.body, undefined);
}

/**
 * Code root for a project vault: parent of `.kmind-knowledge` (or vault root).
 */
export function inferCodeRootFromVault(vaultRoot: string): string {
  const resolved = path.resolve(vaultRoot);
  const base = path.basename(resolved);
  if (base === '.kmind-knowledge') {
    return path.dirname(resolved);
  }
  return resolved;
}
