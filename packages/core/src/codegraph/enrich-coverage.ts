import type { KnowledgeAsset } from '@kmind/shared';
import { collectAssetAnchors } from '../query/anchor-fs.js';
import type {
  CoverageIssue,
  CoverageReport,
} from '../query/coverage.js';
import type { CodegraphClient } from './types.js';

export interface EnrichCoverageSymbolsOptions {
  client: CodegraphClient;
  /** Absolute code / git root for Codegraph -p. */
  projectPath: string;
  enabled?: boolean;
  required?: boolean;
  /** Assets in the same coverage evaluation set. */
  scopedAssets: KnowledgeAsset[];
}

export interface EnrichCoverageSymbolsResult {
  report: CoverageReport;
  codegraphAvailable: boolean | null;
}

/**
 * Async symbol-survival enrichment (ADR-003 M2).
 * Skips assets that already have broken_anchor_path.
 * When unavailable: optional medium issue if required; else leave report issues unchanged.
 */
export async function enrichCoverageSymbols(
  report: CoverageReport,
  options: EnrichCoverageSymbolsOptions,
): Promise<EnrichCoverageSymbolsResult> {
  if (options.enabled === false) {
    return { report, codegraphAvailable: null };
  }

  const available = await options.client.isAvailable(options.projectPath);
  if (!available) {
    if (options.required && hasAnySymbolAnchor(options.scopedAssets)) {
      const issues: CoverageIssue[] = [
        ...report.issues,
        {
          code: 'codegraph_required_unavailable',
          severity: 'medium',
          message:
            'codegraph.required=true 但 Codegraph 不可用（未 init 或 CLI 失败）— 无法校验符号锚点；请 codegraph init 或关闭 required',
        },
      ];
      return {
        report: withIssues(report, issues),
        codegraphAvailable: false,
      };
    }
    return { report, codegraphAvailable: false };
  }

  const brokenFileIds = new Set(
    report.issues
      .filter((i) => i.code === 'broken_anchor_path' && i.assetId)
      .map((i) => i.assetId!),
  );

  const issues: CoverageIssue[] = [...report.issues];
  const seenAsset = new Set<string>();

  for (const asset of options.scopedAssets) {
    if (brokenFileIds.has(asset.id)) continue;
    if (seenAsset.has(asset.id)) continue;
    const anchors = collectAssetAnchors(asset).filter((a) => a.symbol?.trim());
    if (anchors.length === 0) continue;

    const missing: string[] = [];
    for (const anchor of anchors) {
      const symbol = anchor.symbol!.trim();
      const result = await options.client.findSymbol({
        projectPath: options.projectPath,
        symbol,
        file: anchor.file,
      });
      if (!result.found) {
        missing.push(`${anchor.file}·${symbol}`);
      }
    }
    if (missing.length === 0) continue;
    seenAsset.add(asset.id);
    issues.push({
      code: 'broken_anchor_symbol',
      severity: 'medium',
      assetId: asset.id,
      message: `代码锚点符号在 Codegraph 中未找到：${asset.title} — ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}（重构改名后请更新锚点）`,
    });
  }

  return {
    report: withIssues(report, issues),
    codegraphAvailable: true,
  };
}

function hasAnySymbolAnchor(assets: KnowledgeAsset[]): boolean {
  for (const a of assets) {
    if (collectAssetAnchors(a).some((x) => x.symbol?.trim())) return true;
  }
  return false;
}

/**
 * Recompute complete / summary / nextActions after appending issues.
 */
function withIssues(
  report: CoverageReport,
  issues: CoverageIssue[],
): CoverageReport {
  const blocking = issues.filter(
    (i) => i.severity === 'high' || i.severity === 'medium',
  );
  // Empty vault already has high no_hub; hadScope mirrors assessProjectCoverage
  // (complete requires scoped.length > 0 which implies some signal on the report).
  const hadScope =
    report.complete ||
    report.hubs.length > 0 ||
    report.shallow.length > 0 ||
    report.orphans.length > 0 ||
    report.missingAnchors.length > 0 ||
    report.issues.length > 0;
  const complete = blocking.length === 0 && hadScope;

  const nextActions = [...report.nextActions];
  const symbolIds = issues
    .filter((i) => i.code === 'broken_anchor_symbol' && i.assetId)
    .map((i) => i.assetId!);
  if (symbolIds.length > 0) {
    nextActions.unshift(
      `修复断符号锚点（Codegraph 未命中）：${symbolIds.slice(0, 5).join(', ')} — 更新 ## 代码锚点 中的 symbol`,
    );
  }
  if (issues.some((i) => i.code === 'codegraph_required_unavailable')) {
    nextActions.unshift(
      '安装并 codegraph init 项目索引，或将 config.codegraph.required 设为 false',
    );
  }

  const summary = complete
    ? `覆盖合格：project=${report.project}${report.topic ? ` topic=${report.topic}` : ''}，无高/中问题（含符号校验）`
    : `覆盖未完成：${blocking.length} 个高/中问题（共 ${issues.length}）。禁止对外宣称「知识已完整」——请按 nextActions 深挖，勿只刷新总览。`;

  return {
    ...report,
    issues,
    complete,
    nextActions,
    summary,
  };
}
