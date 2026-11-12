import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { KnowledgeAsset } from '@kmind/shared';
import { checkSessionPollution } from '../health/rules/session-pollution.js';
import {
  SEARCH_QUERY_LOG_DIRNAME,
  type SearchQueryLogEntry,
  type SearchQueryLogKind,
} from '../observability/search-query-log.js';
import type { CoverageReport } from './coverage.js';

/** Rolling window for recent pack/search (M1 locked: 24h). */
export const RECENT_RECALL_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ProtocolViolationCode =
  | 'session_pollution'
  | 'no_recent_recall'
  | 'recall_audit_unknown'
  | 'codegraph_unavailable';

export interface ProtocolViolation {
  code: ProtocolViolationCode;
  severity: 'low' | 'medium' | 'high';
  message: string;
  assetId?: string;
}

export type RecentRecallStatus = 'hit' | 'miss' | 'unknown';

export interface RecentRecall {
  status: RecentRecallStatus;
  windowHours: number;
  matchedKind?: SearchQueryLogKind;
  matchedAt?: string;
}

export interface ProtocolReceipt {
  protocolViolation: ProtocolViolation[];
  recentRecall: RecentRecall;
  claimCompleteAllowed: boolean;
}

export interface BuildProtocolReceiptOptions {
  project: string;
  coverage: CoverageReport;
  /** Assets used for session-pollution scan (prefer vault-wide). */
  assetsForPollution: KnowledgeAsset[];
  auditDir: string;
  /** Map pack focusId → asset.project */
  resolveFocusProject?: (focusId: string) => string | undefined;
  now?: Date;
  windowMs?: number;
  /**
   * When false, append codegraph_unavailable (warn only unless coverage already
   * has codegraph_required_unavailable).
   */
  codegraphAvailable?: boolean | null;
}

/**
 * Build Agent-facing protocol receipt (violations + recentRecall).
 * Does not change coverage.complete; claimCompleteAllowed mirrors coverage only.
 */
export async function buildProtocolReceipt(
  options: BuildProtocolReceiptOptions,
): Promise<ProtocolReceipt> {
  const violations: ProtocolViolation[] = [];
  const pollution = checkSessionPollution(options.assetsForPollution);
  for (const issue of pollution) {
    violations.push({
      code: 'session_pollution',
      severity: issue.severity,
      message: issue.message,
      ...(issue.assetId ? { assetId: issue.assetId } : {}),
    });
  }

  const recentRecall = await evaluateRecentRecall({
    auditDir: options.auditDir,
    project: options.project,
    resolveFocusProject: options.resolveFocusProject,
    now: options.now,
    windowMs: options.windowMs,
  });

  if (recentRecall.status === 'miss') {
    violations.push({
      code: 'no_recent_recall',
      severity: 'medium',
      message: `过去 ${recentRecall.windowHours}h 内 project=${options.project} 无 pack/search 召回记录 — 写代码/宣称完整前先 kmind_pack 或 kmind_search`,
    });
  } else if (recentRecall.status === 'unknown') {
    violations.push({
      code: 'recall_audit_unknown',
      severity: 'low',
      message:
        '无法读取 search-query audit（recentRecall=unknown）— 不据此否决 complete，但遵守率不可观测',
    });
  }

  if (options.codegraphAvailable === false) {
    violations.push({
      code: 'codegraph_unavailable',
      severity: 'medium',
      message:
        'Codegraph 不可用：跳过符号存活校验与 pack callers；结构问题请先 codegraph init，或依赖 Skill 手工 codegraph_explore',
    });
  }

  return {
    protocolViolation: violations,
    recentRecall,
    claimCompleteAllowed: options.coverage.complete,
  };
}

/**
 * Evaluate whether the project had pack/search within the window.
 * Match: log.project === project OR focusId resolves to that project.
 */
export async function evaluateRecentRecall(options: {
  auditDir: string;
  project: string;
  resolveFocusProject?: (focusId: string) => string | undefined;
  now?: Date;
  windowMs?: number;
}): Promise<RecentRecall> {
  const windowMs = options.windowMs ?? RECENT_RECALL_WINDOW_MS;
  const windowHours = Math.round(windowMs / (60 * 60 * 1000));
  const now = options.now ?? new Date();
  const project = options.project.trim();

  try {
    const entries = await readSearchQueryLogWindow(
      options.auditDir,
      now,
      windowMs,
    );
    let best: SearchQueryLogEntry | undefined;
    for (const entry of entries) {
      if (!matchesProject(entry, project, options.resolveFocusProject)) {
        continue;
      }
      if (entry.kind !== 'pack' && entry.kind !== 'search') continue;
      if (!best || entry.timestamp > best.timestamp) best = entry;
    }
    if (best) {
      return {
        status: 'hit',
        windowHours,
        matchedKind: best.kind,
        matchedAt: best.timestamp,
      };
    }
    return { status: 'miss', windowHours };
  } catch {
    return { status: 'unknown', windowHours };
  }
}

function matchesProject(
  entry: SearchQueryLogEntry,
  project: string,
  resolveFocusProject?: (focusId: string) => string | undefined,
): boolean {
  if (entry.project && entry.project.trim() === project) return true;
  const focusId = entry.focusId?.trim();
  if (focusId && resolveFocusProject) {
    const p = resolveFocusProject(focusId)?.trim();
    if (p === project) return true;
  }
  return false;
}

/**
 * Load search-query JSONL lines that fall inside [now - windowMs, now].
 * Reads calendar days that may overlap the window (today + yesterday typically).
 */
export async function readSearchQueryLogWindow(
  auditDir: string,
  now: Date,
  windowMs: number,
): Promise<SearchQueryLogEntry[]> {
  const dir = path.join(auditDir, SEARCH_QUERY_LOG_DIRNAME);
  const startMs = now.getTime() - windowMs;
  const dayKeys = new Set<string>();
  dayKeys.add(isoDay(now));
  dayKeys.add(isoDay(new Date(startMs)));
  // Extra day for TZ edge
  dayKeys.add(isoDay(new Date(startMs - 12 * 60 * 60 * 1000)));

  const out: SearchQueryLogEntry[] = [];
  for (const day of dayKeys) {
    const file = path.join(dir, `${day}.jsonl`);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;
      throw err;
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const entry = parsed as SearchQueryLogEntry;
      if (typeof entry.timestamp !== 'string') continue;
      const ts = Date.parse(entry.timestamp);
      if (!Number.isFinite(ts)) continue;
      if (ts < startMs || ts > now.getTime()) continue;
      out.push(entry);
    }
  }
  return out;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
