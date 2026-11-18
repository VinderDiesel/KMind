import { z } from 'zod';

/**
 * Local usefulness signal for pack/search (audit only — never mutates knowledge).
 */
export const RecallFeedbackEntrySchema = z.object({
  version: z.literal('1'),
  useful: z.boolean(),
  focusId: z.string().optional(),
  query: z.string().optional(),
  note: z.string().optional(),
  source: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type RecallFeedbackEntry = z.infer<typeof RecallFeedbackEntrySchema>;

export const RECALL_FEEDBACK_VERSION = '1' as const;
export const RECALL_FEEDBACK_DIRNAME = 'recall-feedback';
