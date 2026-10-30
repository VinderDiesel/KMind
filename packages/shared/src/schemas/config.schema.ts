import { z } from 'zod';

export const KMindConfigSchema = z.object({
  version: z.string(),
  vaultPath: z.string(),
  defaultProject: z.string().default('global'),
  embedding: z
    .object({
      enabled: z.boolean().default(true),
      model: z.string().default('all-MiniLM-L6-v2'),
      dimension: z.number().default(384),
      quantization: z.enum(['none', 'sq8']).default('none'),
      adaptiveIndex: z.boolean().default(true),
      hnswThreshold: z.number().default(10_000),
    })
    .default({}),
  capture: z
    .object({
      /** Pull new sessions from adapters into raw/ during compile. */
      autoCapture: z.boolean().default(false),
      /**
       * Allow compiling `sessions/` raw into knowledge.
       * Still requires env `KMIND_COMPILE_SESSIONS=1` (double lock).
       * Default false — session dumps must never become knowledge by accident.
       */
      compileSessions: z.boolean().default(false),
      minConfidence: z.number().default(0.6),
      /** Extra gate when compileSessions is enabled. */
      sessionMinConfidence: z.number().default(0.9),
      dedupThreshold: z.number().default(0.92),
      /**
       * Run assessCaptureQuality on every manual compile (root quality gate).
       * Failed raw stays pending and does not become an asset.
       */
      requireQualityGate: z.boolean().default(true),
      /**
       * Reject manual captures with missing or `global` project.
       * Forces project-scoped knowledge for reliable filters.
       */
      requireProject: z.boolean().default(true),
    })
    .default({}),
  adapters: z
    .record(
      z.object({
        enabled: z.boolean().default(true),
        /**
         * 5-field cron (min hour dom month dow). Empty/absent = not auto-scheduled.
         */
        schedule: z.string().optional(),
        config: z.record(z.unknown()).default({}),
      }),
    )
    .default({}),
  /**
   * Long-running `kmind schedule start` daemon settings.
   * Per-adapter cron lives under `adapters.<name>.schedule`.
   */
  schedule: z
    .object({
      /** When false, daemon ticks but skips due runs (process may still be up). */
      enabled: z.boolean().default(true),
      /** Daemon poll interval in seconds. */
      tickSeconds: z.number().int().min(10).max(300).default(30),
      /** If a previous maintenance run is still in progress. */
      overlap: z.enum(['skip']).default('skip'),
      /**
       * After adapter maintenance (and on healthCheck.schedule), refresh
       * ADR-002 evolution queue (coverage + lint todos). Never auto-captures.
       */
      evolutionScan: z.boolean().default(true),
    })
    .default({}),
  healthCheck: z
    .object({
      /** Cron for evolution/lint scan when daemon is running (ADR-002). */
      schedule: z.string().default('0 9 * * 1'),
      expiryDays: z.number().default(30),
      /** Warn when architecture_design / code_snippet lack codeAnchors. */
      requireCodeAnchors: z.boolean().default(true),
    })
    .default({}),
  mcp: z
    .object({
      autoApprove: z.array(z.string()).default([]),
      sampleRate: z.number().min(0).max(1).default(0.01),
      cacheSize: z.number().default(256),
      cacheTtlSeconds: z.number().default(30),
    })
    .default({}),
  encryption: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({}),
});
export type KMindConfig = z.infer<typeof KMindConfigSchema>;
