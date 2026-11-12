import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KMindError } from '@kmind/shared';

/** Canonical feature-tree filename inside a project vault. */
export const FEATURE_TREE_FILENAME = 'FEATURE_TREE.md';

export const FEATURE_TREE_GUIDE_START = '<!-- kmind:feature-tree-guide:start -->';
export const FEATURE_TREE_GUIDE_END = '<!-- kmind:feature-tree-guide:end -->';

export type FeatureTreeEnsureAction =
  | 'created'
  | 'guide_updated'
  | 'guide_appended'
  | 'unchanged';

export interface FeatureTreeEnsureResult {
  path: string;
  action: FeatureTreeEnsureAction;
}

/**
 * Resolve bundled `templates/project-vault/FEATURE_TREE.md`.
 */
export async function findFeatureTreeTemplatePath(): Promise<string> {
  const start = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(
      start,
      '..',
      '..',
      '..',
      '..',
      'templates',
      'project-vault',
      FEATURE_TREE_FILENAME,
    ),
    path.resolve(
      start,
      '..',
      '..',
      'templates',
      'project-vault',
      FEATURE_TREE_FILENAME,
    ),
    path.resolve(start, '..', 'templates', 'project-vault', FEATURE_TREE_FILENAME),
  ];
  for (const abs of candidates) {
    try {
      await fs.access(abs);
      return abs;
    } catch {
      /* try next */
    }
  }
  throw new KMindError('FEATURE_TREE template not found', {
    category: 'ADAPTER_ERROR',
    severity: 'medium',
    retryable: false,
    suggestion:
      'Ensure templates/project-vault/FEATURE_TREE.md exists in the KMind checkout',
  });
}

/**
 * Absolute path of FEATURE_TREE.md under a vault root.
 */
export function featureTreePath(vaultRoot: string): string {
  return path.join(path.resolve(vaultRoot), FEATURE_TREE_FILENAME);
}

/**
 * Ensure project vault always has FEATURE_TREE.md.
 * Creates from template when missing; upserts the guide marker block when present.
 */
export async function ensureProjectFeatureTree(
  vaultRoot: string,
): Promise<FeatureTreeEnsureResult> {
  const dest = featureTreePath(vaultRoot);
  const template = await fs.readFile(await findFeatureTreeTemplatePath(), 'utf8');
  const guide = extractGuideSection(template);

  let existed = true;
  try {
    await fs.access(dest);
  } catch {
    existed = false;
  }

  if (!existed) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, ensureTrailingNewline(template), 'utf8');
    return { path: dest, action: 'created' };
  }

  const existing = await fs.readFile(dest, 'utf8');
  const { next, action } = upsertGuideSection(existing, guide);
  if (action !== 'unchanged') {
    await fs.writeFile(dest, next, 'utf8');
  }
  return {
    path: dest,
    action: action === 'unchanged' ? 'unchanged' : action,
  };
}

/**
 * Upsert the marked maintenance-guide block; preserve team tables below/above.
 */
export function upsertGuideSection(
  existing: string,
  guideBody: string,
): {
  next: string;
  action: Exclude<FeatureTreeEnsureAction, 'created'>;
} {
  const section = normalizeGuide(guideBody);
  const start = existing.indexOf(FEATURE_TREE_GUIDE_START);
  const end = existing.indexOf(FEATURE_TREE_GUIDE_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + FEATURE_TREE_GUIDE_END.length);
    const next = `${before}${section}${trimLeadingNewlines(after)}`;
    if (collapseWs(next) === collapseWs(existing)) {
      return { next: existing, action: 'unchanged' };
    }
    return { next: ensureTrailingNewline(next), action: 'guide_updated' };
  }

  const base = existing.replace(/\s*$/, '');
  const next =
    base.length === 0
      ? ensureTrailingNewline(section)
      : `${base}\n\n${ensureTrailingNewline(section)}`;
  return { next, action: 'guide_appended' };
}

function extractGuideSection(template: string): string {
  const start = template.indexOf(FEATURE_TREE_GUIDE_START);
  const end = template.indexOf(FEATURE_TREE_GUIDE_END);
  if (start === -1 || end === -1 || end < start) {
    return normalizeGuide(
      `${FEATURE_TREE_GUIDE_START}\n## 维护约定（强制）\n\n见 KMind 文档。\n${FEATURE_TREE_GUIDE_END}`,
    );
  }
  return normalizeGuide(
    template.slice(start, end + FEATURE_TREE_GUIDE_END.length),
  );
}

function normalizeGuide(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.startsWith(FEATURE_TREE_GUIDE_START) &&
    trimmed.endsWith(FEATURE_TREE_GUIDE_END)
  ) {
    return ensureTrailingNewline(trimmed);
  }
  return ensureTrailingNewline(
    `${FEATURE_TREE_GUIDE_START}\n${trimmed}\n${FEATURE_TREE_GUIDE_END}`,
  );
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

function trimLeadingNewlines(s: string): string {
  return s.replace(/^\n*/, '\n');
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
