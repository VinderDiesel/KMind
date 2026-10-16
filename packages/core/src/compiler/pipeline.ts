import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Vault } from '../storage/vault.js';
import { BlobStore } from '../storage/blob-store.js';
import { MarkdownStore } from '../storage/markdown-store.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import { CaptureStage } from './capture.js';
import { HeuristicClassifier, type Classifier } from './classifier.js';
import { OntologyMapper } from './ontology-mapper.js';
import { GraphBuilder, nextKnowledgeId } from './graph-builder.js';
import { LocalEmbedder, type Embedder } from './embedder.js';
import type { OntologyRegistry } from '../ontology/ontology-registry.js';
import type { OntologyEvolver } from '../ontology/ontology-evolver.js';
import { DiagnosticCollector } from '../observability/diagnostic-collector.js';
import { traceLifecycle } from '../observability/trace.js';
import type { Adapter } from '../adapters/types.js';

export interface CompileOptions {
  incremental?: boolean;
  dryRun?: boolean;
  project?: string;
  force?: boolean;
  /** Override vault `capture.minConfidence` for this run. */
  minConfidence?: number;
}

export interface CompileResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  /** Raw kept pending because classify confidence was below the gate. */
  gated: number;
  failed: Array<{ path: string; error: string }>;
  durationMs: number;
  diagnosticsMarkdown: string;
}

export interface PipelineDeps {
  sqlite: SqliteStore;
  registry: OntologyRegistry;
  evolver?: OntologyEvolver;
  classifier?: Classifier;
  embedder?: Embedder;
  adapters?: Adapter[];
}

export interface CompilePipeline {
  run(options?: CompileOptions): Promise<CompileResult>;
  resume(): Promise<CompileResult>;
  getDiagnostics(): DiagnosticCollector;
}

/**
 * Create the S1–S7 compile pipeline.
 */
export function createPipeline(vault: Vault, deps: PipelineDeps): CompilePipeline {
  return new PipelineImpl(vault, deps);
}

class PipelineImpl implements CompilePipeline {
  private readonly diagnostics = new DiagnosticCollector();
  private seq = 1;

  constructor(
    private readonly vault: Vault,
    private readonly deps: PipelineDeps,
  ) {}

  getDiagnostics(): DiagnosticCollector {
    return this.diagnostics;
  }

  async resume(): Promise<CompileResult> {
    return this.run({ incremental: true, force: false });
  }

  async run(options: CompileOptions = {}): Promise<CompileResult> {
    const start = Date.now();
    const incremental = options.incremental ?? true;
    const project = options.project ?? 'global';
    const result: CompileResult = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      gated: 0,
      failed: [],
      durationMs: 0,
      diagnosticsMarkdown: '',
    };

    this.diagnostics.clear();
    const blob = new BlobStore(this.vault.rawDir);
    const markdown = new MarkdownStore(this.vault.knowledgeDir);
    const capture = new CaptureStage(this.vault.rawDir, blob, this.diagnostics);
    const classifier = this.deps.classifier ?? new HeuristicClassifier();
    const mapper = new OntologyMapper(this.deps.registry, this.deps.evolver);
    const graph = new GraphBuilder(this.deps.sqlite);
    const embedder = this.deps.embedder ?? new LocalEmbedder();
    this.seq = await nextSeqForToday(this.deps.sqlite, new Date());

    const vaultConfig = await this.vault.getConfig();
    const minConfidence =
      options.minConfidence ?? vaultConfig.capture.minConfidence;

    // Optional adapter capture
    for (const adapter of this.deps.adapters ?? []) {
      await capture.captureFromAdapter(adapter);
    }

    await this.deps.sqlite.setCompileState('capture');
    const rawFiles = await capture.listRawFiles();

    for (const absPath of rawFiles) {
      result.processed += 1;
      const relativePath = path.relative(this.vault.rawDir, absPath);
      try {
        const content = await fs.readFile(absPath, 'utf8');
        const hash = blob.hash(content);
        const existing = await this.deps.sqlite.getRawHash(relativePath);
        if (
          incremental &&
          !options.force &&
          existing?.hash === hash &&
          existing.status === 'compiled'
        ) {
          result.skipped += 1;
          continue;
        }

        await this.deps.sqlite.setCompileState('extract', relativePath);
        const candidate = await capture.readRawAsCandidate(absPath);
        traceLifecycle(relativePath, 'capture', { relativePath });

        await this.deps.sqlite.setCompileState('classify', relativePath);
        const classified = await classifier.classify(candidate);
        const isManual =
          relativePath.includes('manual') || Boolean(candidate.typeHint);
        // Hard gate: keep low-confidence adapter raw in pending; manual/typeHint bypass.
        if (!isManual && classified.confidence < minConfidence) {
          result.gated += 1;
          await this.deps.sqlite.setRawHash(relativePath, hash, 'pending');
          this.diagnostics.add({
            category: 'CLASSIFY_ERROR',
            severity: 'medium',
            message: `Gated: confidence ${classified.confidence.toFixed(2)} < ${minConfidence} for ${relativePath}`,
            path: relativePath,
            suggestion:
              'Add typeHint via kmind capture, or raise signal in content; raw kept pending',
          });
          continue;
        }
        if (classified.confidence < minConfidence) {
          this.diagnostics.add({
            category: 'CLASSIFY_ERROR',
            severity: 'low',
            message: `Low confidence (${classified.confidence}) for ${relativePath} (manual bypass)`,
            path: relativePath,
            suggestion: 'Review classification or provide a clearer type',
          });
        }

        await this.deps.sqlite.setCompileState('ontology', relativePath);
        const mapped = mapper.map(classified);
        if (mapped.proposal && this.deps.evolver) {
          await this.deps.evolver.saveProposal(mapped.proposal);
          this.diagnostics.add({
            category: 'ONTOLOGY_ERROR',
            severity: 'low',
            message: `Ontology proposal ${mapped.proposal.id} saved for review`,
            suggestion: 'Review ontology/proposals and apply if appropriate',
          });
        }

        const now = new Date();
        const id = nextKnowledgeId(now, this.seq++);
        const assetProject = candidate.projectHint ?? project;
        const asset = graph.build({
          id,
          title: candidate.title.slice(0, 200) || id,
          project: assetProject,
          body: formatBody(candidate.content, mapped.context, { preferRawBody: isManual }),
          mapped,
          rawPath: relativePath,
          terminal: relativePath.includes('manual') ? 'manual' : 'claude-code',
          timestamp: now.toISOString(),
        });

        const validation = this.deps.registry.validate(asset);
        if (!validation.valid) {
          asset.status = 'draft';
          this.diagnostics.add({
            category: 'ONTOLOGY_ERROR',
            severity: 'medium',
            message: validation.errors.join('; '),
            path: relativePath,
          });
        }

        if (options.dryRun) {
          result.created += 1;
          continue;
        }

        await this.deps.sqlite.setCompileState('graph', relativePath);
        await markdown.write(asset);
        await graph.persist(asset);
        traceLifecycle(asset.id, 'graph');

        await this.deps.sqlite.setCompileState('embed', relativePath);
        try {
          const vec = await embedder.embed(`${asset.title}\n${asset.body}`);
          await this.deps.sqlite.upsertVector(asset.id, vec);
          traceLifecycle(asset.id, 'embed');
        } catch {
          this.diagnostics.add({
            category: 'INDEX_ERROR',
            severity: 'low',
            message: `Embedding pending for ${asset.id}`,
            suggestion: 'Re-run compile when embedder is available',
          });
        }

        await this.deps.sqlite.setCompileState('index', relativePath);
        await this.deps.sqlite.setRawHash(relativePath, hash, 'compiled');
        traceLifecycle(asset.id, 'index');
        result.created += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.failed.push({ path: relativePath, error: message });
        await this.deps.sqlite.setRawHash(relativePath, 'unknown', 'failed');
      }
    }

    result.durationMs = Date.now() - start;
    result.diagnosticsMarkdown = this.diagnostics.toMarkdown();
    return result;
  }
}

function formatBody(
  content: string,
  context: { problem: string; decision: string; rationale: string },
  options?: { preferRawBody?: boolean },
): string {
  const trimmed = content.trim();
  // Manual captures already carry the full note; keep it intact.
  if (options?.preferRawBody && trimmed.length > 0) {
    return trimmed;
  }
  return [
    '## 背景',
    '',
    context.problem || trimmed.slice(0, 500),
    '',
    '## 决策',
    '',
    context.decision,
    '',
    '## 权衡',
    '',
    context.rationale,
  ].join('\n');
}

/**
 * Continue daily knowledge id sequence from existing assets (avoid overwriting).
 */
async function nextSeqForToday(store: SqliteStore, date: Date): Promise<number> {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const prefix = `k-${y}-${m}-${d}-`;
  const assets = await store.queryAssets({ limit: 100_000 });
  let max = 0;
  for (const asset of assets) {
    if (!asset.id.startsWith(prefix)) continue;
    const n = Number.parseInt(asset.id.slice(prefix.length), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}
