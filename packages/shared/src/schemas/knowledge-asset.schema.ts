import { z } from 'zod';

/** Builtin product types shipped with KMind (ADR-001 defaults). */
export const BUILTIN_KNOWLEDGE_TYPES = [
  'problem',
  'outcome',
  'problem_solution',
  'best_practice',
  'architecture_design',
  'tool_usage',
  'pitfall',
  'code_snippet',
  'process_spec',
] as const;

export type BuiltinKnowledgeType = (typeof BUILTIN_KNOWLEDGE_TYPES)[number];

/**
 * Runtime type id (builtin or vault-defined). Validated against AssetTypeRegistry on capture.
 */
export const KnowledgeTypeIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'type id must be snake_case');

/** @deprecated Prefer KnowledgeTypeIdSchema; enum of builtin ids only. */
export const KnowledgeTypeEnum = z.enum(BUILTIN_KNOWLEDGE_TYPES);

export type KnowledgeType = z.infer<typeof KnowledgeTypeIdSchema>;

/**
 * Derive PascalCase ontology class from snake_case type id (ADR-001 short-term compat).
 */
export function typeIdToOntologyClass(typeId: string): string {
  return typeId
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Graph edge kinds between assets (and mentions→Entity in ontology).
 * Use typed `links` on capture for solves/verifies/results_in; `related` = related_to.
 */
export const RelationTypeEnum = z.enum([
  'related_to',
  'derives_from',
  'supersedes',
  'contradicts',
  'mentions',
  'solves',
  'verifies',
  'results_in',
  'part_of',
]);
export type RelationType = z.infer<typeof RelationTypeEnum>;

export const AssetLinkSchema = z.object({
  id: z.string().regex(/^k-\d{4}-\d{2}-\d{2}-\d{3}$/),
  relation: RelationTypeEnum,
});
export type AssetLink = z.infer<typeof AssetLinkSchema>;

export const KnowledgeStatusEnum = z.enum([
  'draft',
  'reviewed',
  'published',
  'deprecated',
]);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusEnum>;

export const TerminalEnum = z.enum([
  'claude-code',
  'cursor',
  'qoder',
  'codex',
  'kiro',
  'manual',
]);
export type Terminal = z.infer<typeof TerminalEnum>;

export const SourceRefSchema = z.object({
  terminal: TerminalEnum,
  sessionId: z.string().optional(),
  messageRange: z.tuple([z.number(), z.number()]).optional(),
  rawPath: z.string(),
  capturedAt: z.string().datetime(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const DecisionTrajectorySchema = z.object({
  problem: z.string(),
  alternatives: z.array(z.string()).default([]),
  decision: z.string(),
  rationale: z.string(),
  tradeOffs: z.array(z.string()).default([]),
  outcome: z.string().optional(),
});
export type DecisionTrajectory = z.infer<typeof DecisionTrajectorySchema>;

export const KnowledgeAssetIdSchema = z
  .string()
  .regex(/^k-\d{4}-\d{2}-\d{2}-\d{3}$/);

/** Stable citation into a codebase (pairs with Codegraph; not a full call graph). */
export const CodeAnchorSchema = z.object({
  file: z.string().min(1).max(500),
  symbol: z.string().min(1).max(200).optional(),
  kind: z.string().min(1).max(64).optional(),
  line: z.number().int().positive().optional(),
  projectPath: z.string().min(1).max(1000).optional(),
  confidence: z.number().min(0).max(1).default(1),
});
export type CodeAnchor = z.infer<typeof CodeAnchorSchema>;

export const KnowledgeAssetSchema = z.object({
  id: KnowledgeAssetIdSchema,
  type: KnowledgeTypeIdSchema,
  title: z.string().min(1).max(200),
  project: z.string().default('global'),
  timestamp: z.string().datetime(),
  status: KnowledgeStatusEnum.default('draft'),
  confidence: z.number().min(0).max(1).default(0.8),
  expiresAt: z.string().datetime().nullable().default(null),
  source: SourceRefSchema,
  context: DecisionTrajectorySchema,
  tags: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  /** Typed outbound edges (preferred over stuffing everything into related_to). */
  links: z.array(AssetLinkSchema).default([]),
  body: z.string(),
  ontologyClass: z.string(),
  metadata: z.record(z.unknown()).default({}),
});
export type KnowledgeAsset = z.infer<typeof KnowledgeAssetSchema>;
