import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findSkillsPackRoot,
  installSkillToTarget,
  listBundledSkills,
  SKILL_TARGETS,
} from './skills.js';

describe('skills pack', () => {
  it('given monorepo when findSkillsPackRoot then locates kmind-capture', async () => {
    const root = await findSkillsPackRoot();
    expect(existsSync(path.join(root, 'kmind-capture', 'SKILL.md'))).toBe(true);
  });

  it('given pack when listBundledSkills then includes capture and code-bridge', async () => {
    const names = await listBundledSkills();
    expect(names).toContain('kmind-capture');
    expect(names).toContain('kmind-code-bridge');
  });

  it('given targets when map then covers all adapters', () => {
    expect(Object.keys(SKILL_TARGETS).sort()).toEqual(
      ['claude-code', 'codex', 'cursor', 'kiro', 'qoder'].sort(),
    );
  });
});

describe('installSkillToTarget', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-skills-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given skill when install then copies SKILL.md', async () => {
    const pack = await findSkillsPackRoot();
    const dest = await installSkillToTarget('kmind-capture', dir, pack);
    expect(dest).toBe(path.join(dir, 'kmind-capture'));
    const body = readFileSync(path.join(dest, 'SKILL.md'), 'utf8');
    expect(body).toContain('name: kmind-capture');
  });
});
