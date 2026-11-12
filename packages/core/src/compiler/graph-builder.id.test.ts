import { describe, expect, it } from 'vitest';
import {
  authorIdSuffix,
  knowledgeIdDayPrefix,
  nextKnowledgeId,
  parseKnowledgeIdSeq,
} from './graph-builder.js';

describe('knowledge id allocation', () => {
  it('given seed when authorIdSuffix then stable 4 hex', () => {
    const a = authorIdSuffix('alice');
    const b = authorIdSuffix('alice');
    const c = authorIdSuffix('bob');
    expect(a).toMatch(/^[0-9a-f]{4}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('given seq when nextKnowledgeId then includes author suffix', () => {
    const date = new Date(Date.UTC(2026, 10, 10));
    const id = nextKnowledgeId(date, 7, 'a3f2');
    expect(id).toBe('k-2026-11-10-007-a3f2');
  });

  it('given old and new ids when parseKnowledgeIdSeq then reads NNN', () => {
    const prefix = knowledgeIdDayPrefix(new Date(Date.UTC(2026, 10, 10)));
    expect(parseKnowledgeIdSeq('k-2026-11-10-003', prefix)).toBe(3);
    expect(parseKnowledgeIdSeq('k-2026-11-10-012-a3f2', prefix)).toBe(12);
    expect(parseKnowledgeIdSeq('k-2026-11-09-001', prefix)).toBeNull();
  });
});
