import { z } from 'zod';

export const EvolutionTodoSourceEnum = z.enum(['health', 'coverage']);
export type EvolutionTodoSource = z.infer<typeof EvolutionTodoSourceEnum>;

export const EvolutionTodoStatusEnum = z.enum(['open', 'done', 'dismissed']);
export type EvolutionTodoStatus = z.infer<typeof EvolutionTodoStatusEnum>;

export const EvolutionTodoSchema = z.object({
  /** Stable id: source:code:assetOrProject */
  id: z.string().min(1),
  source: EvolutionTodoSourceEnum,
  severity: z.enum(['high', 'medium', 'low']),
  project: z.string().optional(),
  assetId: z.string().optional(),
  code: z.string().min(1),
  message: z.string().min(1),
  /** Suggested next step for Agents / humans (not auto-executed). */
  nextAction: z.string().optional(),
  status: EvolutionTodoStatusEnum.default('open'),
  updatedAt: z.string().datetime(),
});
export type EvolutionTodo = z.infer<typeof EvolutionTodoSchema>;

/**
 * Persisted evolution / coverage+lint todo queue (ADR-002).
 * Diagnosis only — never auto-captures.
 */
export const EvolutionQueueSchema = z.object({
  version: z.literal('1'),
  scannedAt: z.string().datetime(),
  items: z.array(EvolutionTodoSchema).default([]),
  summary: z.object({
    open: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
  }),
});
export type EvolutionQueue = z.infer<typeof EvolutionQueueSchema>;

export const EVOLUTION_QUEUE_VERSION = '1' as const;
