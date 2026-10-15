import { z } from 'zod';

export const KnowledgeTypeEnum = z.enum([
  'problem_solution',
  'best_practice',
  'architecture_design',
  'tool_usage',
  'pitfall',
  'code_snippet',
  'process_spec',
]);
export type KnowledgeType = z.infer<typeof KnowledgeTypeEnum>;

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

export const KnowledgeAssetSchema = z.object({
  id: KnowledgeAssetIdSchema,
  type: KnowledgeTypeEnum,
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
  body: z.string(),
  ontologyClass: z.string(),
  metadata: z.record(z.unknown()).default({}),
});
export type KnowledgeAsset = z.infer<typeof KnowledgeAssetSchema>;
