import {
  createQueryEngine,
  runHealthCheck,
  buildEgoGraph,
  buildGlobalGraph,
  filterEgoHealthIssues,
  EGO_DEFAULT_DEPTH,
  EGO_DEFAULT_NODE_CAP,
  GLOBAL_DEFAULT_NODE_CAP,
  GLOBAL_MAX_NODE_CAP,
  type Vault,
  type SqliteStore,
  type HealthIssue,
  type HealthReport,
} from '@kmind/core';
import { KnowledgeTypeEnum, type KnowledgeType } from '@kmind/shared';

export interface UiApiContext {
  vault: Vault;
  store: SqliteStore;
}

const HEALTH_CACHE_TTL_MS = 15_000;

interface HealthCacheEntry {
  report: HealthReport;
  expiresAt: number;
  vaultRoot: string;
}

let healthCache: HealthCacheEntry | null = null;

/**
 * Clear the in-process health report cache (tests / forced refresh).
 */
export function clearUiHealthCache(): void {
  healthCache = null;
}

/**
 * Dispatch a read-only UI API request. Returns JSON-serializable body or null if 404.
 */
export async function handleUiApi(
  ctx: UiApiContext,
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
): Promise<{ status: number; body: unknown }> {
  if (method !== 'GET') {
    return { status: 405, body: { error: 'Method not allowed' } };
  }

  const engine = createQueryEngine(ctx.vault, ctx.store);

  if (pathname === '/api/status') {
    return { status: 200, body: await engine.status() };
  }

  if (pathname === '/api/assets') {
    const limit = clampInt(searchParams.get('limit'), 30, 1, 100);
    const assets = await ctx.store.queryAssets({ limit });
    return {
      status: 200,
      body: {
        results: assets.map((a) => ({
          id: a.id,
          title: a.title,
          type: a.type,
          project: a.project,
          status: a.status,
          timestamp: a.timestamp,
        })),
      },
    };
  }

  if (pathname === '/api/health') {
    const report = await cachedHealthCheck(ctx);
    const ruleFilter = searchParams.get('rule')?.trim() || undefined;
    const severityFilter = searchParams.get('severity')?.trim() || undefined;
    let issues = report.issues;
    if (ruleFilter) {
      issues = issues.filter((i) => i.rule === ruleFilter);
    }
    if (severityFilter) {
      issues = issues.filter((i) => i.severity === severityFilter);
    }
    const byRule: Record<string, number> = {};
    for (const issue of issues) {
      byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1;
    }
    return {
      status: 200,
      body: {
        checkedAt: report.checkedAt,
        issueCount: issues.length,
        totalIssueCount: report.issues.length,
        byRule,
        issues,
      },
    };
  }

  if (pathname === '/api/graph') {
    const nodeCap = clampInt(
      searchParams.get('cap'),
      GLOBAL_DEFAULT_NODE_CAP,
      1,
      GLOBAL_MAX_NODE_CAP,
    );
    const project = searchParams.get('project')?.trim() || undefined;
    const types = parseTypes(searchParams.get('type'));
    const report = await cachedHealthCheck(ctx);
    const graph = await buildGlobalGraph(ctx.store, {
      project,
      types: types.length ? types : undefined,
      nodeCap,
      healthIssues: report.issues,
    });
    return { status: 200, body: graph };
  }

  if (pathname === '/api/search') {
    const q = searchParams.get('q')?.trim() ?? '';
    if (!q) {
      return { status: 400, body: { error: 'Missing q' } };
    }
    const limit = clampInt(searchParams.get('limit'), 20, 1, 50);
    const results = await engine.search({ query: q, limit });
    return {
      status: 200,
      body: {
        query: q,
        results: results.map((r) => ({
          id: r.asset.id,
          title: r.asset.title,
          type: r.asset.type,
          project: r.asset.project,
          score: r.score,
          matchedBy: r.matchedBy,
        })),
      },
    };
  }

  const assetMatch = /^\/api\/assets\/([^/]+)$/.exec(pathname);
  if (assetMatch) {
    const id = decodeURIComponent(assetMatch[1] ?? '');
    const asset = await engine.getById(id);
    if (!asset) return { status: 404, body: { error: 'Asset not found' } };
    return { status: 200, body: asset };
  }

  const egoHealthMatch = /^\/api\/ego\/([^/]+)\/health$/.exec(pathname);
  if (egoHealthMatch) {
    const id = decodeURIComponent(egoHealthMatch[1] ?? '');
    const depth = clampInt(
      searchParams.get('depth'),
      EGO_DEFAULT_DEPTH,
      1,
      5,
    );
    const nodeCap = clampInt(
      searchParams.get('cap'),
      EGO_DEFAULT_NODE_CAP,
      1,
      500,
    );
    const report = await cachedHealthCheck(ctx);
    const ego = await buildEgoGraph(ctx.store, id, {
      depth,
      nodeCap,
      healthIssues: report.issues,
    });
    if (!ego) return { status: 404, body: { error: 'Asset not found' } };
    const nodeIds = new Set(ego.nodes.map((n) => n.id));
    const scoped = filterEgoHealthIssues(report.issues, nodeIds);
    return {
      status: 200,
      body: {
        focusId: id,
        issues: scoped,
        byRule: countByRule(scoped),
      },
    };
  }

  const egoMatch = /^\/api\/ego\/([^/]+)$/.exec(pathname);
  if (egoMatch) {
    const id = decodeURIComponent(egoMatch[1] ?? '');
    const depth = clampInt(
      searchParams.get('depth'),
      EGO_DEFAULT_DEPTH,
      1,
      5,
    );
    const nodeCap = clampInt(
      searchParams.get('cap'),
      EGO_DEFAULT_NODE_CAP,
      1,
      500,
    );
    const report = await cachedHealthCheck(ctx);
    const ego = await buildEgoGraph(ctx.store, id, {
      depth,
      nodeCap,
      healthIssues: report.issues,
    });
    if (!ego) return { status: 404, body: { error: 'Asset not found' } };
    return { status: 200, body: ego };
  }

  return { status: 404, body: { error: 'Not found' } };
}

async function cachedHealthCheck(ctx: UiApiContext): Promise<HealthReport> {
  const now = Date.now();
  if (
    healthCache &&
    healthCache.vaultRoot === ctx.vault.root &&
    healthCache.expiresAt > now
  ) {
    return healthCache.report;
  }
  const report = await runHealthCheck(ctx.vault, ctx.store);
  healthCache = {
    report,
    expiresAt: now + HEALTH_CACHE_TTL_MS,
    vaultRoot: ctx.vault.root,
  };
  return report;
}

function parseTypes(raw: string | null): KnowledgeType[] {
  if (!raw?.trim()) return [];
  const out: KnowledgeType[] = [];
  for (const part of raw.split(',')) {
    const t = part.trim();
    const parsed = KnowledgeTypeEnum.safeParse(t);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function countByRule(issues: HealthIssue[]): Record<string, number> {
  const byRule: Record<string, number> = {};
  for (const issue of issues) {
    byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1;
  }
  return byRule;
}
