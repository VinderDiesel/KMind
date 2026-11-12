import type { KnowledgeAsset } from '@kmind/shared';
import { createCliCodegraphClient } from '../codegraph/cli-client.js';
import { enrichCoverageSymbols } from '../codegraph/enrich-coverage.js';
import type { CodegraphClient } from '../codegraph/types.js';
import type { Vault } from '../storage/vault.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import { inferCodeRootFromVault } from './anchor-fs.js';
import {
  assessProjectCoverage,
  type CoverageOptions,
  type CoverageReport,
} from './coverage.js';
import {
  buildProtocolReceipt,
  type ProtocolViolation,
  type RecentRecall,
} from './protocol-receipt.js';

export type CoverageWithProtocol = CoverageReport & {
  protocolViolation: ProtocolViolation[];
  recentRecall: RecentRecall;
  claimCompleteAllowed: boolean;
  codegraphAvailable?: boolean | null;
};

export interface CoverageProtocolExtras {
  now?: Date;
  exists?: CoverageOptions['exists'];
  cwd?: string;
  /** Inject Codegraph client (tests). */
  codegraphClient?: CodegraphClient;
  /** Skip symbol enrichment. */
  skipCodegraph?: boolean;
}

/**
 * Run coverage with codeRoot inferred from vault, symbol enrichment, protocol receipt.
 */
export async function assessCoverageWithProtocol(
  vault: Vault,
  store: SqliteStore,
  options: Pick<CoverageOptions, 'project' | 'topic' | 'hubId'> &
    CoverageProtocolExtras,
): Promise<CoverageWithProtocol> {
  const project = options.project.trim();
  const assets = await store.queryAssets({
    project,
    limit: 100_000,
  });
  const report = assessProjectCoverage(assets, {
    project,
    topic: options.topic,
    hubId: options.hubId,
    codeRoot: inferCodeRootFromVault(vault.root),
    cwd: options.cwd ?? process.cwd(),
    ...(options.exists ? { exists: options.exists } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return finalizeCoverageWithProtocol(vault, store, report, assets, options);
}

/**
 * Attach protocol (+ optional symbol enrichment) when coverage was already computed.
 */
export async function attachProtocolToCoverage(
  vault: Vault,
  store: SqliteStore,
  report: CoverageReport,
  opts?: CoverageProtocolExtras & {
    pollutionAssets?: KnowledgeAsset[];
    projectAssets?: KnowledgeAsset[];
  },
): Promise<CoverageWithProtocol> {
  const projectAssets =
    opts?.projectAssets ??
    (await store.queryAssets({
      project: report.project,
      limit: 100_000,
    }));
  return finalizeCoverageWithProtocol(
    vault,
    store,
    report,
    projectAssets,
    opts,
  );
}

/**
 * Symbol enrich → protocol receipt.
 */
export async function finalizeCoverageWithProtocol(
  vault: Vault,
  store: SqliteStore,
  report: CoverageReport,
  projectAssets: KnowledgeAsset[],
  opts?: CoverageProtocolExtras & { pollutionAssets?: KnowledgeAsset[] },
): Promise<CoverageWithProtocol> {
  const config = await vault.getConfig();
  const codeRoot = inferCodeRootFromVault(vault.root);
  const scoped = filterScopedAssets(
    projectAssets,
    report.project,
    report.topic,
  );

  let working = report;
  let codegraphAvailable: boolean | null = null;

  if (!opts?.skipCodegraph && config.codegraph.enabled) {
    const client =
      opts?.codegraphClient ??
      createCliCodegraphClient({
        command: config.codegraph.command,
        timeoutMs: config.codegraph.timeoutMs,
      });
    const enriched = await enrichCoverageSymbols(working, {
      client,
      projectPath: codeRoot,
      enabled: true,
      required: config.codegraph.required,
      scopedAssets: scoped,
    });
    working = enriched.report;
    codegraphAvailable = enriched.codegraphAvailable;
  }

  const pollutionAssets =
    opts?.pollutionAssets ??
    (await store.queryAssets({ limit: 100_000 }));

  const focusProjectCache = new Map<string, string | undefined>();
  const receipt = await buildProtocolReceipt({
    project: working.project,
    coverage: working,
    assetsForPollution: pollutionAssets,
    auditDir: vault.auditDir,
    resolveFocusProject: (focusId) => {
      if (focusProjectCache.has(focusId)) return focusProjectCache.get(focusId);
      const hit = pollutionAssets.find((a) => a.id === focusId);
      focusProjectCache.set(focusId, hit?.project);
      return hit?.project;
    },
    now: opts?.now,
    codegraphAvailable,
  });

  return {
    ...working,
    protocolViolation: receipt.protocolViolation,
    recentRecall: receipt.recentRecall,
    claimCompleteAllowed: receipt.claimCompleteAllowed,
    codegraphAvailable,
  };
}

function filterScopedAssets(
  assets: KnowledgeAsset[],
  project: string,
  topic?: string,
): KnowledgeAsset[] {
  const inProject = assets.filter(
    (a) => a.project === project && a.status !== 'deprecated',
  );
  if (!topic?.trim()) return inProject;
  const t = topic.trim().toLowerCase();
  return inProject.filter(
    (a) =>
      a.title.toLowerCase().includes(t) ||
      a.body.toLowerCase().includes(t) ||
      a.tags.some((tag) => tag.toLowerCase().includes(t)),
  );
}
