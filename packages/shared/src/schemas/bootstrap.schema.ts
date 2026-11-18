import { z } from 'zod';
import { KnowledgeTypeIdSchema } from './knowledge-asset.schema.js';

/** Why a scanned path was kept or dropped. */
export const BootstrapModuleReasonEnum = z.enum(['selected', 'excluded']);
export type BootstrapModuleReason = z.infer<typeof BootstrapModuleReasonEnum>;

export const BootstrapModuleKindEnum = z.enum(['package', 'dir', 'file']);
export type BootstrapModuleKind = z.infer<typeof BootstrapModuleKindEnum>;

/**
 * One path considered during deterministic repo inventory (ADR-004).
 * Plan never carries knowledge body text.
 */
export const BootstrapModuleSchema = z.object({
  path: z.string().min(1),
  kind: BootstrapModuleKindEnum,
  reason: BootstrapModuleReasonEnum,
  excludeReason: z.string().optional(),
  /** Approximate source file count under this module (selected only). */
  fileCount: z.number().int().nonnegative().optional(),
});
export type BootstrapModule = z.infer<typeof BootstrapModuleSchema>;

export const DigTaskStatusEnum = z.enum(['todo', 'capturing', 'done']);
export type DigTaskStatus = z.infer<typeof DigTaskStatusEnum>;

export const DigTaskSuggestedAnchorSchema = z.object({
  file: z.string().min(1),
  symbol: z.string().optional(),
});
export type DigTaskSuggestedAnchor = z.infer<typeof DigTaskSuggestedAnchorSchema>;

/**
 * One dig unit for an Agent — candidate type + paths only (no capture body).
 */
export const DigTaskSchema = z.object({
  id: z.string().min(1),
  titleHint: z.string().min(1),
  candidateType: KnowledgeTypeIdSchema,
  paths: z.array(z.string().min(1)).min(1),
  suggestedAnchors: z.array(DigTaskSuggestedAnchorSchema).default([]),
  status: DigTaskStatusEnum.default('todo'),
  /** Soft hints only (e.g. pitfall needs evidence); never auto-capture. */
  notes: z.string().optional(),
  /** Asset id when status=done (from vault dedupe / progress). */
  assetId: z.string().optional(),
});
export type DigTask = z.infer<typeof DigTaskSchema>;

export const DigGroupSchema = z.object({
  label: z.string().min(1),
  tasks: z.array(DigTaskSchema).min(1),
  /** Higher = dig sooner (file-count / package heuristics). */
  priority: z.number().int(),
  /** Optional LLM/heuristic risk notes for the group (never knowledge body). */
  planNotes: z.string().optional(),
});
export type DigGroup = z.infer<typeof DigGroupSchema>;

export const BootstrapPlanStatsSchema = z.object({
  modulesScanned: z.number().int().nonnegative(),
  modulesSelected: z.number().int().nonnegative(),
  modulesExcluded: z.number().int().nonnegative(),
  groupCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  tasksAlreadyDone: z.number().int().nonnegative(),
});
export type BootstrapPlanStats = z.infer<typeof BootstrapPlanStatsSchema>;

/**
 * Deterministic knowledge-init plan (ADR-004). Diagnosis + task list only.
 */
export const BootstrapPlanSchema = z.object({
  version: z.literal('1'),
  project: z.string().min(1),
  repoRoot: z.string().min(1),
  groups: z.array(DigGroupSchema),
  excluded: z.array(BootstrapModuleSchema),
  stats: BootstrapPlanStatsSchema,
  generatedAt: z.string().datetime(),
});
export type BootstrapPlan = z.infer<typeof BootstrapPlanSchema>;

export const BOOTSTRAP_PLAN_VERSION = '1' as const;

/** Vault overlay rule (bootstrap-rules.yaml). First match wins. */
export const BootstrapRuleEntrySchema = z.object({
  pathGlob: z.string().min(1),
  candidateType: KnowledgeTypeIdSchema.optional(),
  titleHint: z.string().optional(),
  notes: z.string().optional(),
  /** When true, module matching this glob is excluded from selection tasks. */
  exclude: z.boolean().optional(),
});
export type BootstrapRuleEntry = z.infer<typeof BootstrapRuleEntrySchema>;

export const BootstrapRulesFileSchema = z.object({
  version: z.literal('1').default('1'),
  rules: z.array(BootstrapRuleEntrySchema).default([]),
});
export type BootstrapRulesFile = z.infer<typeof BootstrapRulesFileSchema>;

export const BootstrapProgressTaskSchema = z.object({
  id: z.string().min(1),
  status: DigTaskStatusEnum,
  assetId: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type BootstrapProgressTask = z.infer<typeof BootstrapProgressTaskSchema>;

/** Persisted dig progress under audit/ (ADR-004 M2). */
export const BootstrapProgressSchema = z.object({
  version: z.literal('1'),
  project: z.string().min(1),
  repoRoot: z.string().min(1),
  planHash: z.string().optional(),
  tasks: z.array(BootstrapProgressTaskSchema).default([]),
  updatedAt: z.string().datetime(),
});
export type BootstrapProgress = z.infer<typeof BootstrapProgressSchema>;

export const BOOTSTRAP_PROGRESS_VERSION = '1' as const;

/** Delegate dig packet for host agents (ADR-004 Phase 3). */
export const BootstrapDigPacketSchema = z.object({
  version: z.literal('1'),
  project: z.string().min(1),
  groupLabel: z.string().min(1),
  tasks: z.array(DigTaskSchema),
  planNotes: z.string().optional(),
  acceptance: z.object({
    coverageTopicHint: z.string(),
    typeMonoWarning: z.string(),
    completeClaimForbiddenUntil: z.string(),
  }),
  toolsHint: z.array(z.string().min(1)).min(1),
});
export type BootstrapDigPacket = z.infer<typeof BootstrapDigPacketSchema>;

export const BOOTSTRAP_DIG_PACKET_VERSION = '1' as const;
