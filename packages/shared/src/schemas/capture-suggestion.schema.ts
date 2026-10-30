import { z } from 'zod';
import {
  AssetLinkSchema,
  CodeAnchorSchema,
  KnowledgeTypeIdSchema,
} from './knowledge-asset.schema.js';

export const CaptureSuggestionKindEnum = z.enum([
  'duplicate',
  'type',
  'related_hub',
  'link',
  'anchors',
  'quality',
]);
export type CaptureSuggestionKind = z.infer<typeof CaptureSuggestionKindEnum>;

/**
 * One actionable suggestion for smart capture (ADR-002).
 * Agents show these to humans; accepted fields are re-sent on kmind_capture.
 */
export const CaptureSuggestionSchema = z.object({
  id: z.string().min(1),
  kind: CaptureSuggestionKindEnum,
  /** Human-readable reason (Chinese/English ok). */
  message: z.string().min(1),
  /** Confidence 0–1 for ranking. */
  confidence: z.number().min(0).max(1).default(0.7),
  /** Fields to merge into the next capture call when accepted. */
  apply: z
    .object({
      type: KnowledgeTypeIdSchema.optional(),
      related: z.array(z.string()).optional(),
      links: z.array(AssetLinkSchema).optional(),
      anchors: z.array(CodeAnchorSchema).optional(),
      /** If true, recommend superseding / not capturing (dup). */
      skipCapture: z.boolean().optional(),
      /** Prefer updating this existing id instead of new card. */
      preferExistingId: z.string().optional(),
    })
    .default({}),
});
export type CaptureSuggestion = z.infer<typeof CaptureSuggestionSchema>;

export const CaptureSuggestReportSchema = z.object({
  version: z.literal('1'),
  title: z.string(),
  project: z.string(),
  /** Type used for analysis (after optional suggestion). */
  type: KnowledgeTypeIdSchema,
  suggestions: z.array(CaptureSuggestionSchema),
  /** Ready-to-merge snapshot if all high-confidence non-skip suggestions accepted. */
  proposedCapture: z
    .object({
      type: KnowledgeTypeIdSchema,
      related: z.array(z.string()).default([]),
      links: z.array(AssetLinkSchema).default([]),
      anchors: z.array(CodeAnchorSchema).default([]),
    })
    .optional(),
  hints: z.array(z.string()).default([]),
});
export type CaptureSuggestReport = z.infer<typeof CaptureSuggestReportSchema>;

export const CAPTURE_SUGGEST_VERSION = '1' as const;
