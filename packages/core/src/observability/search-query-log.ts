import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Max top-hit rows kept per log line (enough for ranking QA, not full result dumps). */
export const SEARCH_QUERY_LOG_TOP_HITS = 5;

/** Subdir under vault `audit/` for hybrid search / pack query logs. */
export const SEARCH_QUERY_LOG_DIRNAME = 'search-queries';

export type SearchQueryLogKind = 'search' | 'pack';

export interface SearchQueryLogHit {
  id: string;
  score: number;
  matchedBy?: string[];
  title?: string;
}

/**
 * One vault-local search/pack query record (JSONL under `audit/search-queries/`).
 * Lives only in the active vault (global `~/.kmind` or project `.kmind-knowledge/`).
 */
export interface SearchQueryLogEntry {
  kind: SearchQueryLogKind;
  query: string;
  project?: string;
  type?: string;
  limit?: number;
  resultCount: number;
  topHits: SearchQueryLogHit[];
  empty: boolean;
  latencyMs: number;
  /** Caller channel: cli | mcp | ui | engine | … */
  source?: string;
  cacheHit?: boolean;
  /** Pack focus id when kind=pack. */
  focusId?: string | null;
  timestamp: string;
}

/**
 * Absolute path for a day's search-query JSONL file.
 */
export function searchQueryLogPath(auditDir: string, dayIsoDate: string): string {
  return path.join(auditDir, SEARCH_QUERY_LOG_DIRNAME, `${dayIsoDate}.jsonl`);
}

/**
 * Append one search/pack query log line under `vault/audit/search-queries/YYYY-MM-DD.jsonl`.
 * Never throws to callers — failures are swallowed so recall paths stay available.
 */
export async function appendSearchQueryLog(
  auditDir: string,
  entry: Omit<SearchQueryLogEntry, 'timestamp'> & { timestamp?: string },
): Promise<void> {
  try {
    const full: SearchQueryLogEntry = {
      ...entry,
      query: entry.query ?? '',
      topHits: (entry.topHits ?? []).slice(0, SEARCH_QUERY_LOG_TOP_HITS),
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };
    const day = full.timestamp.slice(0, 10);
    const dir = path.join(auditDir, SEARCH_QUERY_LOG_DIRNAME);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${day}.jsonl`);
    await fs.appendFile(file, `${JSON.stringify(full)}\n`, 'utf8');
  } catch {
    // Observability must not break search/pack.
  }
}
