import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  installProjectAgentContext,
  upsertKmindSection,
  KMIND_SECTION_START,
  KMIND_SECTION_END,
} from './project-context.js';

const SAMPLE_SECTION = `${KMIND_SECTION_START}
## KMind 团队知识协议（强制）
probe-content
${KMIND_SECTION_END}
`;

describe('upsertKmindSection', () => {
  it('given no markers when upsert then appends section', () => {
    const { next, action } = upsertKmindSection('# custom\n', SAMPLE_SECTION);
    expect(action).toBe('section_appended');
    expect(next.startsWith('# custom')).toBe(true);
    expect(next).toContain(KMIND_SECTION_START);
    expect(next).toContain('probe-content');
  });

  it('given existing markers when upsert then replaces block only', () => {
    const existing = `# custom\n\n${KMIND_SECTION_START}\nold\n${KMIND_SECTION_END}\n\n## more\n`;
    const { next, action } = upsertKmindSection(existing, SAMPLE_SECTION);
    expect(action).toBe('section_updated');
    expect(next).toContain('# custom');
    expect(next).toContain('## more');
    expect(next).toContain('probe-content');
    expect(next).not.toContain('\nold\n');
  });
});

describe('installProjectAgentContext', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-project-context-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given empty cwd when install then creates AGENTS CLAUDE and copilot files', async () => {
    const results = await installProjectAgentContext(dir);

    expect(existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'CLAUDE.md'))).toBe(true);
    expect(
      existsSync(path.join(dir, '.github', 'copilot-instructions.md')),
    ).toBe(true);
    expect(results.every((r) => r.action === 'created')).toBe(true);
    expect(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toContain(
      KMIND_SECTION_START,
    );
  });

  it('given existing AGENTS.md when install then appends kmind section', async () => {
    writeFileSync(path.join(dir, 'AGENTS.md'), '# custom team rules\n', 'utf8');

    const results = await installProjectAgentContext(dir);
    const agents = results.find((r) => r.path.endsWith('AGENTS.md'));
    const body = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

    expect(agents?.action).toBe('section_appended');
    expect(body).toContain('# custom team rules');
    expect(body).toContain('KMind 团队知识协议');
    expect(body).toContain(KMIND_SECTION_START);
  });

  it('given agents with kmind markers when install again then updates in place', async () => {
    writeFileSync(
      path.join(dir, 'AGENTS.md'),
      `# custom\n\n${KMIND_SECTION_START}\nold-protocol\n${KMIND_SECTION_END}\n`,
      'utf8',
    );

    const results = await installProjectAgentContext(dir);
    const agents = results.find((r) => r.path.endsWith('AGENTS.md'));
    const body = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

    expect(agents?.action).toBe('section_updated');
    expect(body).toContain('# custom');
    expect(body).toContain('KMind 团队知识协议');
    expect(body).not.toContain('old-protocol');
  });

  it('given second install with same section when install then unchanged', async () => {
    await installProjectAgentContext(dir);
    mkdirSync(path.join(dir, 'keep'), { recursive: true });
    const first = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    const results = await installProjectAgentContext(dir);
    const agents = results.find((r) => r.path.endsWith('AGENTS.md'));
    const second = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

    expect(agents?.action).toBe('section_unchanged');
    expect(second).toBe(first);
  });
});
