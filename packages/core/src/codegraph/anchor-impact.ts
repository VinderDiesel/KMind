import type {
  CodeAnchor,
  KnowledgeAsset,
  KnowledgeType,
  PackAnchorImpact,
} from '@kmind/shared';
import { collectAssetAnchors } from '../query/anchor-fs.js';
import type { CodegraphClient } from './types.js';

export interface BuildAnchorImpactOptions {
  client: CodegraphClient;
  projectPath: string;
  focus: KnowledgeAsset;
  anchors: CodeAnchor[];
  /** Same-project peers for co-cite (exclude focus). */
  projectAssets: KnowledgeAsset[];
  enabled?: boolean;
  callersLimit?: number;
  coCiteLimit?: number;
}

/**
 * Build ephemeral pack.anchorImpact: Codegraph callers + same-project co-cites.
 */
export async function buildAnchorImpact(
  options: BuildAnchorImpactOptions,
): Promise<PackAnchorImpact[]> {
  const coCiteLimit = options.coCiteLimit ?? 5;
  const callersLimit = options.callersLimit ?? 8;
  const enabled = options.enabled !== false;

  let available = false;
  if (enabled) {
    available = await options.client.isAvailable(options.projectPath);
  }

  const out: PackAnchorImpact[] = [];
  for (const anchor of options.anchors) {
    const symbol = anchor.symbol?.trim();
    const coCiting = findCoCiting(
      options.projectAssets,
      options.focus.id,
      anchor.file,
      symbol,
      coCiteLimit,
    );

    if (!enabled || !available || !symbol) {
      out.push({
        file: anchor.file,
        ...(symbol ? { symbol } : {}),
        codegraphAvailable: enabled ? available : false,
        callers: [],
        coCiting,
        ...(symbol && enabled && available
          ? { symbolFound: undefined }
          : symbol && enabled && !available
            ? {}
            : {}),
      });
      continue;
    }

    const found = await options.client.findSymbol({
      projectPath: options.projectPath,
      symbol,
      file: anchor.file,
    });
    const callers = found.found
      ? await options.client.listCallers({
          projectPath: options.projectPath,
          symbol,
          file: anchor.file,
          limit: callersLimit,
        })
      : [];

    out.push({
      file: anchor.file,
      symbol,
      symbolFound: found.found,
      codegraphAvailable: true,
      callers: callers.map((c) => ({
        name: c.name,
        filePath: c.filePath,
        ...(c.kind ? { kind: c.kind } : {}),
        ...(c.startLine ? { startLine: c.startLine } : {}),
      })),
      coCiting,
    });
  }
  return out;
}

/**
 * Same-project assets whose anchors share file|symbol with the focus anchor.
 */
export function findCoCiting(
  assets: KnowledgeAsset[],
  focusId: string,
  file: string,
  symbol: string | undefined,
  limit: number,
): Array<{ id: string; title: string; type: KnowledgeType }> {
  const fileNorm = normalizePath(file);
  const out: Array<{ id: string; title: string; type: KnowledgeType }> = [];
  for (const a of assets) {
    if (a.id === focusId) continue;
    if (a.status === 'deprecated') continue;
    const anchors = collectAssetAnchors(a);
    const hit = anchors.some((x) => {
      if (normalizePath(x.file) !== fileNorm) return false;
      if (!symbol) return true;
      return (x.symbol?.trim() ?? '') === symbol;
    });
    if (!hit) continue;
    out.push({ id: a.id, title: a.title, type: a.type });
    if (out.length >= limit) break;
  }
  return out;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
