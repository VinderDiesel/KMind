import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  RECALL_FEEDBACK_DIRNAME,
  RECALL_FEEDBACK_VERSION,
  RecallFeedbackEntrySchema,
  type RecallFeedbackEntry,
} from '@kmind/shared';

/**
 * Append one local recall usefulness feedback line under audit/recall-feedback/.
 * Does not mutate knowledge Markdown.
 */
export async function appendRecallFeedback(
  auditDir: string,
  entry: Omit<RecallFeedbackEntry, 'timestamp' | 'version'> & {
    timestamp?: string;
  },
): Promise<string> {
  const full = RecallFeedbackEntrySchema.parse({
    version: RECALL_FEEDBACK_VERSION,
    useful: entry.useful,
    focusId: entry.focusId,
    query: entry.query,
    note: entry.note,
    source: entry.source,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  });
  const day = full.timestamp.slice(0, 10);
  const dir = path.join(auditDir, RECALL_FEEDBACK_DIRNAME);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${day}.jsonl`);
  await fs.appendFile(file, `${JSON.stringify(full)}\n`, 'utf8');
  return file;
}
