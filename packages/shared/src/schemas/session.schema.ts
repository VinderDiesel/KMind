import { z } from 'zod';
import { TerminalEnum } from './knowledge-asset.schema.js';

export const SessionMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string(),
  timestamp: z.string().datetime(),
  toolName: z.string().optional(),
  toolInput: z.unknown().optional(),
  toolOutput: z.unknown().optional(),
});
export type SessionMessage = z.infer<typeof SessionMessageSchema>;

export const SessionRecordSchema = z.object({
  terminal: TerminalEnum,
  sessionId: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  project: z.string().optional(),
  messages: z.array(SessionMessageSchema),
  metadata: z.record(z.unknown()).default({}),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
