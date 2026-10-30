import { z } from 'zod';
import {
  KnowledgeTypeIdSchema,
  RelationTypeEnum,
} from './knowledge-asset.schema.js';

/** Types that must stay enabled (problem closure). */
export const KERNEL_ASSET_TYPES = [
  'problem',
  'problem_solution',
  'outcome',
] as const;

export type KernelAssetType = (typeof KERNEL_ASSET_TYPES)[number];

export const DetailFamilyEnum = z.enum([
  'implementation',
  'cautions',
  'redlines',
]);
export type DetailFamily = z.infer<typeof DetailFamilyEnum>;

/**
 * Whitelist predicates for capture quality (no arbitrary scripts).
 * Evaluated by core assessCaptureQuality / rule interpreter.
 */
export const AssetTypeRuleSchema = z.union([
  z.object({ minBodyChars: z.number().int().positive() }).strict(),
  z.object({ maxBodyChars: z.number().int().positive() }).strict(),
  z
    .object({
      requireDetailFamilies: z.array(DetailFamilyEnum).min(1),
    })
    .strict(),
  z.object({ requireLinkRelation: RelationTypeEnum }).strict(),
  z.object({ hintLinkRelation: RelationTypeEnum }).strict(),
  z.object({ requireCodeCitation: z.literal(true) }).strict(),
  z.object({ requireConcreteSignals: z.literal(true) }).strict(),
  z
    .object({
      requirePatterns: z.array(z.string().min(1)).min(1),
      message: z.string().min(1),
    })
    .strict(),
]);
export type AssetTypeRule = z.infer<typeof AssetTypeRuleSchema>;

/**
 * Maps to legacy capture-quality branches for builtins.
 * Custom types omit this and rely on rules / requiredSections.
 */
export const LegacyQualityProfileEnum = z.enum([
  'feature',
  'problem',
  'outcome',
  'solution',
]);
export type LegacyQualityProfile = z.infer<typeof LegacyQualityProfileEnum>;

export const AssetTypeDefSchema = z.object({
  id: KnowledgeTypeIdSchema,
  enabled: z.boolean().default(true),
  label: z.string().min(1).max(80).optional(),
  scaffold: z.string().max(8000).default(''),
  guidance: z.string().max(8000).default(''),
  requiredSections: z.array(z.string().min(1).max(80)).default([]),
  rules: z.array(AssetTypeRuleSchema).default([]),
  classifyPatterns: z.array(z.string().min(1).max(200)).default([]),
  /** PascalCase ontology class; defaults to derived from id when omitted. */
  ontologyClass: z.string().min(1).max(120).optional(),
  /** When true (or id in KERNEL_ASSET_TYPES), enabled:false is rejected. */
  kernel: z.boolean().optional(),
  legacyProfile: LegacyQualityProfileEnum.optional(),
});
export type AssetTypeDef = z.infer<typeof AssetTypeDefSchema>;

/**
 * Whether this type id is a locked kernel type.
 */
export function isKernelAssetType(id: string): boolean {
  return (KERNEL_ASSET_TYPES as readonly string[]).includes(id);
}
