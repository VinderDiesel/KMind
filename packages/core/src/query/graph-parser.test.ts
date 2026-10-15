import { describe, expect, it } from 'vitest';
import { parseGraphQuery } from './graph-parser.js';

describe('parseGraphQuery', () => {
  it('given MATCH WHERE RETURN LIMIT when parse then extracts clauses', () => {
    const q = parseGraphQuery(`
      MATCH (a:ArchitectureDesign)-[:derives_from]->(b:Pitfall)
      WHERE a.project = 'payment-service'
      RETURN a, b
      LIMIT 20
    `);
    expect(q.match.leftClass).toBe('ArchitectureDesign');
    expect(q.match.relation).toBe('derives_from');
    expect(q.match.rightClass).toBe('Pitfall');
    expect(q.where[0]?.value).toBe('payment-service');
    expect(q.returns).toEqual(['a', 'b']);
    expect(q.limit).toBe(20);
  });

  it('given invalid MATCH when parse then throws', () => {
    expect(() => parseGraphQuery('SELECT *')).toThrow(/Invalid MATCH/);
  });
});
