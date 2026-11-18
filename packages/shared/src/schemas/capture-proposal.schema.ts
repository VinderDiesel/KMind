import { z } from 'zod';
import {
  AssetLinkSchema,
  CodeAnchorSchema,
  KnowledgeTypeIdSchema,
} from './knowledge-asset.schema.js';

export const CaptureProposalStatusEnum = z.enum([
  'open',
  'committed',
  'cancelled',
]);
export type CaptureProposalStatus = z.infer<typeof CaptureProposalStatusEnum>;

export const CaptureProposalFieldsSchema = z.object({
  content: z.string().min(1),
  title: z.string().min(1),
  type: KnowledgeTypeIdSchema,
  project: z.string().min(1),
  anchors: z.array(CodeAnchorSchema).optional(),
  related: z.array(z.string().min(1)).optional(),
  links: z.array(AssetLinkSchema).optional(),
  bootstrapTask: z.string().optional(),
});
export type CaptureProposalFields = z.infer<typeof CaptureProposalFieldsSchema>;

/**
 * Staged capture intent (ADR-002 propose/commit). Lives under audit/ only.
 */
export const CaptureProposalSchema = z.object({
  version: z.literal('1'),
  id: z.string().min(1),
  status: CaptureProposalStatusEnum,
  fields: CaptureProposalFieldsSchema,
  suggestionsDigest: z.string().optional(),
  createdAt: z.string().datetime(),
  committedAt: z.string().datetime().optional(),
  assetId: z.string().optional(),
});
export type CaptureProposal = z.infer<typeof CaptureProposalSchema>;

export const CAPTURE_PROPOSAL_VERSION = '1' as const;
