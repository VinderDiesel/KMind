import {
  createQueryEngine,
  runHealthCheck,
  buildEgoGraph,
  filterEgoHealthIssues,
  EGO_DEFAULT_DEPTH,
  EGO_DEFAULT_NODE_CAP,
  type Vault,
  type SqliteStore,
} from '@kmind/core';

export interface UiApiContext {
  vault: Vault;
  store: SqliteStore;
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

  if (pathname === '/api/health') {
    const report = await runHealthCheck(ctx.vault, ctx.store);
    const byRule: Record<string, number> = {};
    for (const issue of report.issues) {
      byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1;
    }
    return {
      status: 200,
      body: {
        checkedAt: report.checkedAt,
        issueCount: report.issues.length,
        byRule,
        issues: report.issues,
      },
    };
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
    const report = await runHealthCheck(ctx.vault, ctx.store);
    const ego = await buildEgoGraph(ctx.store, id, {
      depth,
      nodeCap,
      healthIssues: report.issues,
    });
    if (!ego) return { status: 404, body: { error: 'Asset not found' } };
    const nodeIds = new Set(ego.nodes.map((n) => n.id));
    return {
      status: 200,
      body: {
        focusId: id,
        issues: filterEgoHealthIssues(report.issues, nodeIds),
        byRule: countByRule(filterEgoHealthIssues(report.issues, nodeIds)),
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
    const report = await runHealthCheck(ctx.vault, ctx.store);
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

function countByRule(
  issues: Array<{ rule: string }>,
): Record<string, number> {
  const byRule: Record<string, number> = {};
  for (const issue of issues) {
    byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1;
  }
  return byRule;
}
