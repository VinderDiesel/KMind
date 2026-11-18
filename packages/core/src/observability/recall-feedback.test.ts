import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendRecallFeedback } from './recall-feedback.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('appendRecallFeedback', () => {
  it('given useful feedback when append then jsonl line exists', async () => {
    const auditDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-fb-'));
    tmpDirs.push(auditDir);
    const file = await appendRecallFeedback(auditDir, {
      useful: true,
      focusId: 'k-2026-11-18-001-abcd',
      query: 'lock',
    });
    expect(file).toContain('recall-feedback');
    const body = await fs.readFile(file, 'utf8');
    expect(body).toContain('"useful":true');
  });
});
