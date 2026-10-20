import type { KnowledgeAsset } from '@kmind/shared';
import type { SqliteStore } from '../storage/sqlite-store.js';

export type ProblemResolutionStatus =
  | 'open'
  | 'addressed'
  | 'verified'
  | 'not_a_problem';

export interface ProblemStatusReport {
  problemId: string;
  title: string;
  status: ProblemResolutionStatus;
  /** Assets with solves → this problem */
  solutions: Array<{ id: string; title: string; type: string }>;
  /** Assets with verifies → this problem */
  outcomes: Array<{ id: string; title: string; type: string }>;
  /** Human-readable: open | has solution but no verify | solved+verified */
  summary: string;
}

/**
 * Infer whether a problem is open / addressed / verified from typed edges.
 * - open: no inbound `solves`
 * - addressed: has `solves`, no `verifies`
 * - verified: has both `solves` and `verifies`
 */
export async function getProblemStatus(
  store: SqliteStore,
  problemId: string,
): Promise<ProblemStatusReport | { error: string; problemId: string }> {
  const asset = await store.getAsset(problemId);
  if (!asset) return { error: 'not_found', problemId };
  if (asset.type !== 'problem') {
    return {
      problemId,
      title: asset.title,
      status: 'not_a_problem',
      solutions: [],
      outcomes: [],
      summary: `Asset type is ${asset.type}, not problem`,
    };
  }

  const inbound = await store.getInboundRelations(problemId);
  const solveIds = inbound
    .filter((r) => r.relationType === 'solves')
    .map((r) => r.fromId);
  const verifyIds = inbound
    .filter((r) => r.relationType === 'verifies')
    .map((r) => r.fromId);

  const solutions = await loadBriefs(store, solveIds);
  const outcomes = await loadBriefs(store, verifyIds);

  let status: ProblemResolutionStatus = 'open';
  if (solutions.length > 0 && outcomes.length > 0) status = 'verified';
  else if (solutions.length > 0) status = 'addressed';

  const summary =
    status === 'verified'
      ? `已解决并验证：${solutions.length} 个方案，${outcomes.length} 个结果`
      : status === 'addressed'
        ? `已有方案尚未验证：${solutions.length} 个 solves，0 个 verifies`
        : '开放中：尚无 solves 边';

  return {
    problemId,
    title: asset.title,
    status,
    solutions,
    outcomes,
    summary,
  };
}

async function loadBriefs(
  store: SqliteStore,
  ids: string[],
): Promise<Array<{ id: string; title: string; type: string }>> {
  const out: Array<{ id: string; title: string; type: string }> = [];
  for (const id of [...new Set(ids)]) {
    const a: KnowledgeAsset | null = await store.getAsset(id);
    if (a) out.push({ id: a.id, title: a.title, type: a.type });
  }
  return out;
}
