import type { Adapter } from '../adapters/types.js';
import { CaptureStage } from '../compiler/capture.js';
import {
  createPipeline,
  type CompileResult,
  type PipelineDeps,
} from '../compiler/pipeline.js';
import { runHealthCheck, type HealthReport } from '../health/checker.js';
import { DiagnosticCollector } from '../observability/diagnostic-collector.js';
import { BlobStore } from '../storage/blob-store.js';
import type { Vault } from '../storage/vault.js';
import { KMindError } from '@kmind/shared';

export interface MaintenanceDeps extends PipelineDeps {
  adapters: Adapter[];
}

export interface AdapterMaintenanceResult {
  adapter: string;
  captured: number;
  compile: Pick<
    CompileResult,
    'processed' | 'created' | 'updated' | 'skipped' | 'gated' | 'failed' | 'durationMs'
  >;
  lint: { issueCount: number; checkedAt: string };
  reindex: { assetCount: number };
  durationMs: number;
}

/**
 * Run full maintenance for one adapter: capture → compile → lint → reindex.
 * Does not enable global autoCapture; only the named adapter is pulled into raw/.
 * Session dual-gate still applies during compile.
 */
export async function runAdapterMaintenance(
  vault: Vault,
  deps: MaintenanceDeps,
  adapterName: string,
): Promise<AdapterMaintenanceResult> {
  const start = Date.now();
  const adapter = deps.adapters.find((a) => a.name === adapterName);
  if (!adapter) {
    throw new KMindError(`Unknown adapter: ${adapterName}`, {
      category: 'ADAPTER_ERROR',
      severity: 'medium',
      retryable: false,
      suggestion: 'Run `kmind adapters list` to see available adapters',
    });
  }

  const diagnostics = new DiagnosticCollector();
  const blob = new BlobStore(vault.rawDir);
  const capture = new CaptureStage(vault.rawDir, blob, diagnostics);
  const captured = await capture.captureFromAdapter(adapter);

  const pipeline = createPipeline(vault, {
    sqlite: deps.sqlite,
    registry: deps.registry,
    evolver: deps.evolver,
    classifier: deps.classifier,
    embedder: deps.embedder,
    // Intentionally omit adapters so compile does not re-pull everyone via autoCapture.
  });
  const compile = await pipeline.run({ incremental: true });

  const lintReport: HealthReport = await runHealthCheck(vault, deps.sqlite);
  await deps.sqlite.rebuildFromMarkdown(vault.knowledgeDir);
  const assetCount = await deps.sqlite.countAssets();

  return {
    adapter: adapterName,
    captured: captured.length,
    compile: {
      processed: compile.processed,
      created: compile.created,
      updated: compile.updated,
      skipped: compile.skipped,
      gated: compile.gated,
      failed: compile.failed,
      durationMs: compile.durationMs,
    },
    lint: {
      issueCount: lintReport.issues.length,
      checkedAt: lintReport.checkedAt,
    },
    reindex: { assetCount },
    durationMs: Date.now() - start,
  };
}
