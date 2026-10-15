import { describe, expect, it } from 'vitest';
import { createSessionRecord } from '../factories.js';
import { SessionRecordSchema } from './session.schema.js';

describe('SessionRecordSchema', () => {
  it('given valid session when parse then succeeds', () => {
    const session = createSessionRecord('cursor');
    const result = SessionRecordSchema.safeParse(session);
    expect(result.success).toBe(true);
  });

  it('given invalid role when parse then fails', () => {
    const session = createSessionRecord();
    const bad = {
      ...session,
      messages: [{ role: 'system', content: 'x', timestamp: '2026-10-15T12:00:00.000Z' }],
    };
    const result = SessionRecordSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
