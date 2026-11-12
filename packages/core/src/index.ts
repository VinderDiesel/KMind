export { createVault, type Vault } from './storage/vault.js';
export {
  resolveVaultRoot,
  findProjectVault,
  projectVaultPath,
  PROJECT_VAULT_DIRNAME,
  type ResolveVaultRootOptions,
} from './storage/resolve-vault.js';

export { MarkdownStore } from './storage/markdown-store.js';
export { SqliteStore, type SearchQuery as StoreSearchQuery } from './storage/sqlite-store.js';
export { BlobStore } from './storage/blob-store.js';
export { FieldEncryption } from './storage/encryption.js';

export { loadOntology, saveOntology } from './ontology/ontology-loader.js';
export { OntologyRegistry } from './ontology/ontology-registry.js';
export {
  AssetTypeRegistry,
  createAssetTypeRegistry,
  type AssetTypeListItem,
} from './asset-types/registry.js';
export {
  loadAssetTypes,
  loadBuiltinAssetTypes,
  loadVaultAssetTypeOverlays,
} from './asset-types/loader.js';
export { mergeAssetTypeDef, mergeAssetTypeMaps } from './asset-types/merge.js';
export { BUILTIN_ASSET_TYPES } from './asset-types/builtins.js';
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
  enrichAssetCodeAnchors,
  assetHasCodeAnchors,
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
  buildCaptureSuggestions,
  type CaptureSuggestInput,
  type CaptureSuggestDeps,
} from './compiler/capture-suggest.js';
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
  type CoverageIssueCode,
} from './query/coverage.js';
export {
  assessCoverageWithProtocol,
  attachProtocolToCoverage,
  type CoverageWithProtocol,
} from './query/coverage-with-protocol.js';
export {
  buildProtocolReceipt,
  evaluateRecentRecall,
  RECENT_RECALL_WINDOW_MS,
  type ProtocolReceipt,
  type ProtocolViolation,
  type RecentRecall,
} from './query/protocol-receipt.js';
export {
  inferCodeRootFromVault,
  anchorFileExists,
  resolveAnchorPathCandidates,
} from './query/anchor-fs.js';
export {
  listExpiredAssets,
  retireExpired,
  deprecateAllExpired,
  type RetireAction,
  type RetireExpiredResult,
  type ExpiredAssetBrief,
} from './lifecycle/retire-expired.js';
export {
  createCliCodegraphClient,
  symbolNameMatches,
  filePathMatches,
} from './codegraph/cli-client.js';
export type {
  CodegraphClient,
  CodegraphCaller,
  CodegraphSymbolMatch,
} from './codegraph/types.js';
export { enrichCoverageSymbols } from './codegraph/enrich-coverage.js';
export {
  buildAnchorImpact,
  findCoCiting,
} from './codegraph/anchor-impact.js';

export {
  createQueryEngine,
  type QueryEngine,
  type SearchQuery,
  type SearchResult,
} from './query/engine.js';
export {
  buildContextPack,
  type BuildContextPackOptions,
} from './query/context-pack.js';
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

export {
  parseCron,
  cronMatches,
  nextCron,
  minuteSlot,
  assertValidCron,
  type CronExpr,
  type CronField,
} from './schedule/cron.js';
export {
  runAdapterMaintenance,
  type MaintenanceDeps,
  type AdapterMaintenanceResult,
} from './schedule/maintenance.js';
export {
  loadScheduleState,
  saveScheduleState,
  markRunStart,
  markRunFinish,
  scheduleStatePath,
  schedulePidPath,
  ScheduleStateSchema,
  type ScheduleState,
  type AdapterRunState,
} from './schedule/state.js';
export {
  evolutionQueuePath,
  loadEvolutionQueue,
  saveEvolutionQueue,
  runEvolutionScan,
  updateEvolutionTodoStatus,
  type EvolutionScanResult,
} from './schedule/evolution-queue.js';

export { createLogger } from './observability/logger.js';
export { DiagnosticCollector } from './observability/diagnostic-collector.js';
export { AuditLogger } from './observability/audit.js';
export {
  appendSearchQueryLog,
  searchQueryLogPath,
  SEARCH_QUERY_LOG_DIRNAME,
  SEARCH_QUERY_LOG_TOP_HITS,
  type SearchQueryLogEntry,
  type SearchQueryLogHit,
  type SearchQueryLogKind,
} from './observability/search-query-log.js';
export { traceLifecycle } from './observability/trace.js';
