import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  RECALL_STATS_VERSION,
  RecallStatsReportSchema,
  type RecallStatsReport,
} from '@kmind/shared';
import {
  SEARCH_QUERY_LOG_DIRNAME,
  type SearchQueryLogEntry,
} from './search-query-log.js';

/**
 * Summarize vault-local search/pack query logs into a RecallStatsReport.
 * Never throws for missing/corrupt files — returns empty|partial|ok.
 */
export async function summarizeSearchQueryLogs(options: {
  auditDir: string;
  windowHours: number;
  project?: string;
  now?: Date;
}): Promise<RecallStatsReport> {
  const windowHours = Math.max(1, Math.floor(options.windowHours));
  const now = options.now ?? new Date();
  const projectFilter = options.project?.trim() || undefined;
  const windowMs = windowHours * 60 * 60 * 1000;

  const { entries, hadBadLines, hadReadError } = await readWindow(
    options.auditDir,
    now,
    windowMs,
  );

  let used = entries;
  let skippedForProject = false;
  if (projectFilter) {
    const kept: SearchQueryLogEntry[] = [];
    for (const e of entries) {
      if (e.project?.trim() === projectFilter) {
        kept.push(e);
      } else if (!e.project?.trim()) {
        skippedForProject = true;
      }
    }
    used = kept;
  }

  const totals = {
    queries: used.length,
    search: 0,
    pack: 0,
    empty: 0,
    cacheHits: 0,
  };
  const bySource: Record<string, number> = {};
  const focusCounts = new Map<string, number>();

  for (const e of used) {
    if (e.kind === 'search') totals.search += 1;
    if (e.kind === 'pack') totals.pack += 1;
    if (e.empty) totals.empty += 1;
    if (e.cacheHit) totals.cacheHits += 1;
    const src = (e.source ?? 'unknown').trim() || 'unknown';
    bySource[src] = (bySource[src] ?? 0) + 1;
    const focus = e.focusId?.trim();
    if (focus) {
      focusCounts.set(focus, (focusCounts.get(focus) ?? 0) + 1);
    }
  }

  const topFocusIds = [...focusCounts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, 10);

  const emptyRate = totals.queries === 0 ? 0 : totals.empty / totals.queries;

  let status: RecallStatsReport['status'] = 'ok';
  if (totals.queries === 0) {
    status = hadBadLines || hadReadError || skippedForProject ? 'partial' : 'empty';
  } else if (hadBadLines || hadReadError || skippedForProject) {
    status = 'partial';
  }

  return RecallStatsReportSchema.parse({
    version: RECALL_STATS_VERSION,
    status,
    windowHours,
    ...(projectFilter ? { project: projectFilter } : {}),
    totals,
    emptyRate,
    bySource,
    topFocusIds,
    generatedAt: now.toISOString(),
  });
}

async function readWindow(
  auditDir: string,
  now: Date,
  windowMs: number,
): Promise<{
  entries: SearchQueryLogEntry[];
  hadBadLines: boolean;
  hadReadError: boolean;
}> {
  const dir = path.join(auditDir, SEARCH_QUERY_LOG_DIRNAME);
  const startMs = now.getTime() - windowMs;
  const dayKeys = new Set<string>();
  dayKeys.add(isoDay(now));
  dayKeys.add(isoDay(new Date(startMs)));
  dayKeys.add(isoDay(new Date(startMs - 12 * 60 * 60 * 1000)));

  const entries: SearchQueryLogEntry[] = [];
  let hadBadLines = false;
  let hadReadError = false;

  for (const day of dayKeys) {
    const file = path.join(dir, `${day}.jsonl`);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;
      hadReadError = true;
      continue;
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        hadBadLines = true;
        continue;
      }
      if (!parsed || typeof parsed !== 'object') {
        hadBadLines = true;
        continue;
      }
      const entry = parsed as SearchQueryLogEntry;
      if (typeof entry.timestamp !== 'string' || typeof entry.kind !== 'string') {
        hadBadLines = true;
        continue;
      }
      const ts = Date.parse(entry.timestamp);
      if (!Number.isFinite(ts)) {
        hadBadLines = true;
        continue;
      }
      if (ts < startMs || ts > now.getTime()) continue;
      entries.push(entry);
    }
  }

  return { entries, hadBadLines, hadReadError };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
