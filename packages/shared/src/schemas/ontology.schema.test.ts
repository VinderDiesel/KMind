import { describe, expect, it } from 'vitest';
import { OntologySchema } from './ontology.schema.js';

describe('OntologySchema', () => {
  it('given valid ontology when parse then succeeds', () => {
    const result = OntologySchema.safeParse({
      version: '1.0',
      classes: {
        KnowledgeAsset: {
          abstract: true,
          properties: { id: { type: 'string', required: true } },
        },
      },
      relations: {
        related_to: {
          from: 'KnowledgeAsset',
          to: 'KnowledgeAsset',
          symmetric: true,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('given invalid version when parse then fails', () => {
    const result = OntologySchema.safeParse({
      version: 'v1',
      classes: {},
      relations: {},
    });
    expect(result.success).toBe(false);
  });
});
