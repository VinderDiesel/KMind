import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SEARCH_QUERY_LOG_DIRNAME } from './search-query-log.js';
import { summarizeSearchQueryLogs } from './recall-stats.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('summarizeSearchQueryLogs', () => {
  it('given no jsonl when summarize then status empty and zero totals', async () => {
    const auditDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-recall-empty-'));
    tmpDirs.push(auditDir);
    const report = await summarizeSearchQueryLogs({
      auditDir,
      windowHours: 24,
    });
    expect(report.status).toBe('empty');
    expect(report.totals.queries).toBe(0);
  });

  it('given search and pack lines when summarize then counts and emptyRate', async () => {
    const auditDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-recall-ok-'));
    tmpDirs.push(auditDir);
    const day = '2026-11-18';
    const dir = path.join(auditDir, SEARCH_QUERY_LOG_DIRNAME);
    await fs.mkdir(dir, { recursive: true });
    const now = new Date('2026-11-18T12:00:00.000Z');
    const lines = [
      {
        kind: 'search',
        query: 'a',
        project: 'demo',
        resultCount: 1,
        topHits: [],
        empty: false,
        latencyMs: 1,
        source: 'cli',
        timestamp: '2026-11-18T11:00:00.000Z',
      },
      {
        kind: 'search',
        query: 'b',
        project: 'demo',
        resultCount: 0,
        topHits: [],
        empty: true,
        latencyMs: 1,
        source: 'mcp',
        timestamp: '2026-11-18T11:30:00.000Z',
      },
      {
        kind: 'pack',
        query: 'c',
        project: 'demo',
        resultCount: 2,
        topHits: [],
        empty: false,
        latencyMs: 2,
        source: 'mcp',
        focusId: 'k-2026-11-18-001-abcd',
        timestamp: '2026-11-18T11:45:00.000Z',
      },
    ];
    await fs.writeFile(
      path.join(dir, `${day}.jsonl`),
      `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
      'utf8',
    );

    const report = await summarizeSearchQueryLogs({
      auditDir,
      windowHours: 24,
      project: 'demo',
      now,
    });
    expect(report.status).toBe('ok');
    expect(report.totals.search).toBe(2);
    expect(report.totals.pack).toBe(1);
    expect(report.emptyRate).toBeCloseTo(1 / 3, 5);
  });
});
