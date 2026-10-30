import { z } from 'zod';
import {
  CodeAnchorSchema,
  KnowledgeTypeIdSchema,
} from './knowledge-asset.schema.js';

/** Compact asset projection for Agent context (not a full KnowledgeAsset dump). */
export const PackAssetBriefSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: KnowledgeTypeIdSchema,
  project: z.string(),
  status: z.string().optional(),
  confidence: z.number().optional(),
  /** Truncated body for prompt packing. */
  bodyExcerpt: z.string(),
  tags: z.array(z.string()).default([]),
  links: z
    .array(
      z.object({
        id: z.string(),
        relation: z.string(),
      }),
    )
    .default([]),
  related: z.array(z.string()).default([]),
});
export type PackAssetBrief = z.infer<typeof PackAssetBriefSchema>;

export const PackSearchHitSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: KnowledgeTypeIdSchema,
  score: z.number(),
  matchedBy: z.array(z.string()),
});
export type PackSearchHit = z.infer<typeof PackSearchHitSchema>;

export const PackNeighborNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: KnowledgeTypeIdSchema,
  hop: z.number().int().nonnegative(),
  project: z.string(),
  hasCodeAnchors: z.boolean(),
});
export type PackNeighborNode = z.infer<typeof PackNeighborNodeSchema>;

export const PackNeighborLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  relationType: z.string(),
});
export type PackNeighborLink = z.infer<typeof PackNeighborLinkSchema>;

export const PackProblemStatusSchema = z.object({
  problemId: z.string(),
  title: z.string(),
  status: z.enum(['open', 'addressed', 'verified', 'not_a_problem']),
  summary: z.string(),
  solutions: z.array(z.object({ id: z.string(), title: z.string(), type: z.string() })),
  outcomes: z.array(z.object({ id: z.string(), title: z.string(), type: z.string() })),
});
export type PackProblemStatus = z.infer<typeof PackProblemStatusSchema>;

/**
 * Structured recall pack for Agents (ADR-002).
 * Versioned contract — bump `version` when breaking fields change.
 */
export const ContextPackSchema = z.object({
  version: z.literal('1'),
  /** Echo of the request query (when resolved via search). */
  query: z.string().optional(),
  /** Primary focus asset; null when nothing matched. */
  focus: PackAssetBriefSchema.nullable(),
  /** Other hybrid hits (excluding focus). */
  alternatives: z.array(PackSearchHitSchema).default([]),
  /** Ego neighborhood around focus. */
  neighborhood: z
    .object({
      depth: z.number().int().positive(),
      truncated: z.boolean(),
      nodes: z.array(PackNeighborNodeSchema),
      links: z.array(PackNeighborLinkSchema),
    })
    .nullable(),
  /** Code anchors on the focus card. */
  codeAnchors: z.array(CodeAnchorSchema).default([]),
  /** Present when focus.type === problem (or requested id is a problem). */
  problemStatus: PackProblemStatusSchema.nullable().default(null),
  /** Soft related assets (brief), depth 1. */
  related: z.array(PackAssetBriefSchema).default([]),
  /** Machine hints for Agents (not LLM prose answers). */
  hints: z.array(z.string()).default([]),
});
export type ContextPack = z.infer<typeof ContextPackSchema>;

export const CONTEXT_PACK_VERSION = '1' as const;
