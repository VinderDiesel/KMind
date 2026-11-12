import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendSearchQueryLog,
  searchQueryLogPath,
  SEARCH_QUERY_LOG_DIRNAME,
} from './search-query-log.js';

describe('appendSearchQueryLog', () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('given search entry when append then writes daily jsonl under audit/search-queries', async () => {
    // given
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-search-log-'));
    const auditDir = path.join(tmp, 'audit');

    // when
    await appendSearchQueryLog(auditDir, {
      kind: 'search',
      query: '问数 SSE',
      project: 'meta-brain',
      limit: 10,
      resultCount: 2,
      topHits: [
        { id: 'k-2026-11-10-007-ce5a', score: 1.2, matchedBy: ['fulltext'] },
        { id: 'k-2026-11-10-006-ce5a', score: 0.9, matchedBy: ['graph'] },
      ],
      empty: false,
      latencyMs: 12,
      source: 'cli',
      timestamp: '2026-11-11T01:02:03.000Z',
    });

    // then
    const file = searchQueryLogPath(auditDir, '2026-11-11');
    expect(file).toContain(path.join(SEARCH_QUERY_LOG_DIRNAME, '2026-11-11.jsonl'));
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(row.kind).toBe('search');
    expect(row.query).toBe('问数 SSE');
    expect(row.project).toBe('meta-brain');
    expect(row.resultCount).toBe(2);
    expect(row.empty).toBe(false);
    expect(row.source).toBe('cli');
  });

  it('given append failure when disk unusable then does not throw', async () => {
    // given — auditDir points at a file path so mkdir fails
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-search-log-'));
    const blocker = path.join(tmp, 'not-a-dir');
    await fs.writeFile(blocker, 'x', 'utf8');

    // when / then
    await expect(
      appendSearchQueryLog(blocker, {
        kind: 'pack',
        query: 'x',
        resultCount: 0,
        topHits: [],
        empty: true,
        latencyMs: 1,
      }),
    ).resolves.toBeUndefined();
  });
});
