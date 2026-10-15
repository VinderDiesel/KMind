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
      autoCapture: z.boolean().default(true),
      minConfidence: z.number().default(0.6),
      dedupThreshold: z.number().default(0.92),
    })
    .default({}),
  adapters: z
    .record(
      z.object({
        enabled: z.boolean().default(true),
        config: z.record(z.unknown()).default({}),
      }),
    )
    .default({}),
  healthCheck: z
    .object({
      schedule: z.string().default('0 9 * * 1'),
      expiryDays: z.number().default(30),
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
