import type { SqliteStore } from '../storage/sqlite-store.js';
import { parseGraphQuery } from './graph-parser.js';
import type { SearchResult } from './types.js';

/**
 * Execute a simplified Cypher-like graph query.
 */
export async function graphQuery(
  store: SqliteStore,
  cypherLike: string,
): Promise<unknown[]> {
  const parsed = parseGraphQuery(cypherLike);
  const relations = await store.getRelations();
  const results: unknown[] = [];

  if (!parsed.match.relation) {
    const assets = await store.queryAssets({ limit: parsed.limit });
    for (const asset of assets) {
      if (parsed.match.leftClass && asset.ontologyClass !== parsed.match.leftClass) {
        continue;
      }
      if (!matchWhere(parsed.where, { [parsed.match.leftVar]: asset })) continue;
      results.push({ [parsed.match.leftVar]: asset });
      if (results.length >= parsed.limit) break;
    }
    return results;
  }

  for (const rel of relations) {
    if (rel.relationType !== parsed.match.relation) continue;
    const a = await store.getAsset(rel.fromId);
    const b = await store.getAsset(rel.toId);
    if (!a || !b) continue;
    if (parsed.match.leftClass && a.ontologyClass !== parsed.match.leftClass) continue;
    if (parsed.match.rightClass && b.ontologyClass !== parsed.match.rightClass) continue;
    const binding = {
      [parsed.match.leftVar]: a,
      [parsed.match.rightVar]: b,
    };
    if (!matchWhere(parsed.where, binding)) continue;
    const row: Record<string, unknown> = {};
    for (const r of parsed.returns) {
      row[r] = binding[r];
    }
    results.push(row);
    if (results.length >= parsed.limit) break;
  }
  return results;
}

/**
 * Graph-neighborhood search for hybrid fusion.
 */
export async function graphNeighborhoodSearch(
  store: SqliteStore,
  seedIds: string[],
  depth = 1,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  for (const id of seedIds) {
    const relatedIds = await store.getRelated(id, depth);
    for (const rid of relatedIds) {
      const asset = await store.getAsset(rid);
      if (asset) {
        results.push({ asset, score: 0.5, matchedBy: ['graph'] });
      }
    }
  }
  return results;
}

function matchWhere(
  where: Array<{ field: string; op: '=' | '>' | '<'; value: string | number }>,
  binding: Record<string, { project?: string; confidence?: number; ontologyClass?: string }>,
): boolean {
  for (const w of where) {
    const [varName, prop] = w.field.split('.');
    const obj = binding[varName ?? ''];
    if (!obj) return false;
    const actual = (obj as Record<string, unknown>)[prop ?? ''];
    if (w.op === '=' && actual !== w.value) return false;
    if (w.op === '>' && !(Number(actual) > Number(w.value))) return false;
    if (w.op === '<' && !(Number(actual) < Number(w.value))) return false;
  }
  return true;
}
