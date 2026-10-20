export { createVault, type Vault } from './storage/vault.js';
export { MarkdownStore } from './storage/markdown-store.js';
export { SqliteStore, type SearchQuery as StoreSearchQuery } from './storage/sqlite-store.js';
export { BlobStore } from './storage/blob-store.js';
export { FieldEncryption } from './storage/encryption.js';

export { loadOntology, saveOntology } from './ontology/ontology-loader.js';
export { OntologyRegistry } from './ontology/ontology-registry.js';
export {
  OntologyEvolver,
  EVOLVER_CONFIDENCE_THRESHOLD,
  EVOLVER_DEMOTE_PERIODS,
  type OntologyProposal,
} from './ontology/ontology-evolver.js';

export {
  createPipeline,
  isSessionCompileAllowed,
  type CompileOptions,
  type CompileResult,
  type CompilePipeline,
  type PipelineDeps,
} from './compiler/pipeline.js';
export {
  HeuristicClassifier,
  OllamaClassifier,
  type Classifier,
  type ClassificationResult,
  type RawCandidate,
} from './compiler/classifier.js';
export { LocalEmbedder, hashEmbed, type Embedder } from './compiler/embedder.js';
export {
  extractCodeAnchors,
  readCodeAnchors,
  withCodeAnchorsMetadata,
} from './compiler/code-anchors.js';
export { sanitizeTitle } from './compiler/title.js';
export {
  assessCaptureQuality,
  hasCodeCitation,
  isOverviewTitle,
  type CaptureQualityResult,
  type CaptureQualityOptions,
} from './compiler/capture-quality.js';
export {
  getProblemStatus,
  type ProblemStatusReport,
  type ProblemResolutionStatus,
} from './query/problem-status.js';
export {
  assessProjectCoverage,
  assessOverviewChildrenDepth,
  type CoverageReport,
  type CoverageIssue,
  type CoverageOptions,
} from './query/coverage.js';

export {
  createQueryEngine,
  type QueryEngine,
  type SearchQuery,
  type SearchResult,
} from './query/engine.js';
export { hybridSearch } from './query/hybrid.js';
export { parseGraphQuery } from './query/graph-parser.js';
export {
  buildEgoGraph,
  filterEgoHealthIssues,
  EGO_DEFAULT_DEPTH,
  EGO_DEFAULT_NODE_CAP,
  EGO_MAX_DEPTH,
  type EgoGraph,
  type EgoLink,
  type EgoNode,
} from './query/ego.js';
export {
  buildGlobalGraph,
  GLOBAL_DEFAULT_NODE_CAP,
  GLOBAL_MAX_NODE_CAP,
  type GlobalGraph,
} from './query/global-graph.js';

export { runHealthCheck, type HealthReport } from './health/checker.js';
export type { HealthIssue } from './health/rules/expiry.js';
export {
  Exporter,
  EXPORT_FORMAT_VERSION,
  initGitRepo,
  type ExportFilter,
  type ExportManifest,
  type ExportToGitOptions,
} from './migration/exporter.js';
export {
  Importer,
  type ImportOptions,
  type ImportResult,
  type ImportConflictPolicy,
} from './migration/importer.js';

export type {
  Adapter,
  McpConfigTemplate,
  LifecycleHookConfig,
} from './adapters/types.js';

export { createLogger } from './observability/logger.js';
export { DiagnosticCollector } from './observability/diagnostic-collector.js';
export { AuditLogger } from './observability/audit.js';
export { traceLifecycle } from './observability/trace.js';
