import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { appendSearchQueryLog } from '../observability/search-query-log.js';
import {
  buildProtocolReceipt,
  evaluateRecentRecall,
} from './protocol-receipt.js';
import type { CoverageReport } from './coverage.js';

function emptyCoverage(project: string): CoverageReport {
  return {
    project,
    complete: true,
    hubs: [],
    duplicateOverviews: [],
    shallow: [],
    missingAnchors: [],
    orphans: [],
    issues: [],
    nextActions: [],
    summary: 'ok',
  };
}

describe('evaluateRecentRecall', () => {
  let auditDir: string;

  beforeEach(() => {
    resetFactoryCounters();
    auditDir = mkdtempSync(path.join(tmpdir(), 'kmind-recall-'));
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('given pack log with matching project within 24h when evaluate then hit', async () => {
    const now = new Date('2026-11-12T12:00:00.000Z');
    await appendSearchQueryLog(auditDir, {
      kind: 'pack',
      query: 'router',
      project: 'meta-brain',
      resultCount: 1,
      topHits: [{ id: 'k-2026-11-12-001', score: 1 }],
      empty: false,
      latencyMs: 3,
      source: 'test',
      timestamp: '2026-11-12T10:00:00.000Z',
    });
    const r = await evaluateRecentRecall({
      auditDir,
      project: 'meta-brain',
      now,
    });
    expect(r.status).toBe('hit');
    expect(r.matchedKind).toBe('pack');
  });

  it('given pack with focusId mapping to project when evaluate then hit', async () => {
    const now = new Date('2026-11-12T12:00:00.000Z');
    await appendSearchQueryLog(auditDir, {
      kind: 'pack',
      query: '',
      resultCount: 1,
      topHits: [],
      empty: false,
      latencyMs: 1,
      focusId: 'k-2026-11-12-099',
      timestamp: '2026-11-12T11:00:00.000Z',
    });
    const r = await evaluateRecentRecall({
      auditDir,
      project: 'meta-brain',
      now,
      resolveFocusProject: (id) =>
        id === 'k-2026-11-12-099' ? 'meta-brain' : undefined,
    });
    expect(r.status).toBe('hit');
  });

  it('given no matching logs when evaluate then miss', async () => {
    const r = await evaluateRecentRecall({
      auditDir,
      project: 'meta-brain',
      now: new Date('2026-11-12T12:00:00.000Z'),
    });
    expect(r.status).toBe('miss');
  });
});

describe('buildProtocolReceipt', () => {
  let auditDir: string;

  beforeEach(() => {
    resetFactoryCounters();
    auditDir = mkdtempSync(path.join(tmpdir(), 'kmind-proto-'));
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('given session pollution when build then protocolViolation without flipping complete', async () => {
    const dirty = createKnowledgeAsset({
      title: 'sess_cursor-noise',
      terminal: 'cursor',
      project: 'meta-brain',
    });
    Object.assign(dirty.source, {
      rawPath: 'sessions/cursor/foo.jsonl',
      terminal: 'cursor',
    });
    const receipt = await buildProtocolReceipt({
      project: 'meta-brain',
      coverage: emptyCoverage('meta-brain'),
      assetsForPollution: [dirty],
      auditDir,
      now: new Date('2026-11-12T12:00:00.000Z'),
    });
    expect(receipt.claimCompleteAllowed).toBe(true);
    expect(
      receipt.protocolViolation.some((v) => v.code === 'session_pollution'),
    ).toBe(true);
    expect(receipt.recentRecall.status).toBe('miss');
    expect(
      receipt.protocolViolation.some((v) => v.code === 'no_recent_recall'),
    ).toBe(true);
  });

  it('given day jsonl is a directory when evaluate then unknown', async () => {
    const day = '2026-11-12';
    const logDir = path.join(auditDir, 'search-queries');
    await fs.mkdir(path.join(logDir, `${day}.jsonl`), { recursive: true });
    const r = await evaluateRecentRecall({
      auditDir,
      project: 'meta-brain',
      now: new Date('2026-11-12T12:00:00.000Z'),
    });
    expect(r.status).toBe('unknown');
  });
});
