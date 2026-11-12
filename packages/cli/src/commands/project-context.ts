import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KMindError } from '@kmind/shared';

export const KMIND_SECTION_START = '<!-- kmind:agent-protocol:start -->';
export const KMIND_SECTION_END = '<!-- kmind:agent-protocol:end -->';

export type ProjectContextAction =
  | 'created'
  | 'section_appended'
  | 'section_updated'
  | 'section_unchanged';

export interface ProjectContextInstallResult {
  path: string;
  action: ProjectContextAction;
}

/**
 * Resolve bundled `templates/project-context/` (AGENTS.md and tool entrypoints).
 */
export async function findProjectContextTemplateRoot(): Promise<string> {
  const start = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(start, '..', '..', '..', '..', 'templates', 'project-context'),
    path.resolve(start, '..', '..', 'templates', 'project-context'),
    path.resolve(start, '..', 'templates', 'project-context'),
  ];
  for (const abs of candidates) {
    try {
      await fs.access(path.join(abs, 'AGENTS.md'));
      return abs;
    } catch {
      /* try next */
    }
  }
  throw new KMindError('project-context templates not found', {
    category: 'ADAPTER_ERROR',
    severity: 'medium',
    retryable: false,
    suggestion:
      'Ensure templates/project-context/AGENTS.md exists in the KMind checkout',
  });
}

/**
 * Upsert the marked KMind protocol block into existing markdown.
 * Preserves all content outside the markers.
 */
export function upsertKmindSection(
  existing: string,
  sectionBody: string,
): { next: string; action: Exclude<ProjectContextAction, 'created'> } {
  const section = normalizeSection(sectionBody);
  const start = existing.indexOf(KMIND_SECTION_START);
  const end = existing.indexOf(KMIND_SECTION_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + KMIND_SECTION_END.length);
    const next = `${before}${section}${trimLeadingNewlines(after)}`;
    if (collapseWs(next) === collapseWs(existing)) {
      return { next: existing, action: 'section_unchanged' };
    }
    return { next: ensureTrailingNewline(next), action: 'section_updated' };
  }

  const base = existing.replace(/\s*$/, '');
  const next =
    base.length === 0
      ? ensureTrailingNewline(section)
      : `${base}\n\n${ensureTrailingNewline(section)}`;
  return { next, action: 'section_appended' };
}

/**
 * Install / merge AGENTS.md, CLAUDE.md, Copilot instructions.
 * Existing files keep team content; KMind block is appended or replaced in place.
 */
export async function installProjectAgentContext(
  cwd: string,
): Promise<ProjectContextInstallResult[]> {
  const templateRoot = await findProjectContextTemplateRoot();
  const results: ProjectContextInstallResult[] = [];

  const targets: Array<{
    destRel: string;
    fullTemplate: string;
    sectionFile: string;
  }> = [
    {
      destRel: 'AGENTS.md',
      fullTemplate: 'AGENTS.md',
      sectionFile: 'AGENTS.kmind-section.md',
    },
    {
      destRel: 'CLAUDE.md',
      fullTemplate: 'CLAUDE.md',
      sectionFile: 'CLAUDE.kmind-section.md',
    },
    {
      destRel: path.join('.github', 'copilot-instructions.md'),
      fullTemplate: 'copilot-instructions.md',
      sectionFile: 'copilot.kmind-section.md',
    },
  ];

  for (const t of targets) {
    const dest = path.join(cwd, t.destRel);
    const section = await fs.readFile(
      path.join(templateRoot, t.sectionFile),
      'utf8',
    );
    let existed = true;
    try {
      await fs.access(dest);
    } catch {
      existed = false;
    }

    if (!existed) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const full = await fs.readFile(
        path.join(templateRoot, t.fullTemplate),
        'utf8',
      );
      await fs.writeFile(dest, ensureTrailingNewline(full), 'utf8');
      results.push({ path: dest, action: 'created' });
      continue;
    }

    const existing = await fs.readFile(dest, 'utf8');
    const { next, action } = upsertKmindSection(existing, section);
    if (action !== 'section_unchanged') {
      await fs.writeFile(dest, next, 'utf8');
    }
    results.push({ path: dest, action });
  }

  return results;
}

function normalizeSection(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.startsWith(KMIND_SECTION_START) &&
    trimmed.endsWith(KMIND_SECTION_END)
  ) {
    return ensureTrailingNewline(trimmed);
  }
  return ensureTrailingNewline(
    `${KMIND_SECTION_START}\n${trimmed}\n${KMIND_SECTION_END}`,
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
