import { z } from 'zod';

export const RecallStatsStatusEnum = z.enum(['ok', 'empty', 'partial']);
export type RecallStatsStatus = z.infer<typeof RecallStatsStatusEnum>;

export const RecallStatsTotalsSchema = z.object({
  queries: z.number().int().nonnegative(),
  search: z.number().int().nonnegative(),
  pack: z.number().int().nonnegative(),
  empty: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
});
export type RecallStatsTotals = z.infer<typeof RecallStatsTotalsSchema>;

export const RecallStatsFocusCountSchema = z.object({
  id: z.string().min(1),
  count: z.number().int().positive(),
});
export type RecallStatsFocusCount = z.infer<typeof RecallStatsFocusCountSchema>;

/**
 * Local recall observability from audit/search-queries JSONL (ADR-002 M6).
 * Never leaves the vault; not a cloud metric.
 */
export const RecallStatsReportSchema = z.object({
  version: z.literal('1'),
  status: RecallStatsStatusEnum,
  windowHours: z.number().int().positive(),
  project: z.string().optional(),
  totals: RecallStatsTotalsSchema,
  emptyRate: z.number().min(0).max(1),
  bySource: z.record(z.string(), z.number().int().nonnegative()),
  topFocusIds: z.array(RecallStatsFocusCountSchema).max(10),
  generatedAt: z.string().datetime(),
});
export type RecallStatsReport = z.infer<typeof RecallStatsReportSchema>;

export const RECALL_STATS_VERSION = '1' as const;
