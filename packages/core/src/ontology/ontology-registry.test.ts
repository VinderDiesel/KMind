import { describe, expect, it } from 'vitest';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { OntologyRegistry } from './ontology-registry.js';
import type { Ontology } from '@kmind/shared';

const sample: Ontology = {
  version: '1.0',
  classes: {
    KnowledgeAsset: { abstract: true, properties: {} },
    BestPractice: { parent: 'KnowledgeAsset', abstract: false, properties: {} },
  },
  relations: {
    related_to: {
      from: 'KnowledgeAsset',
      to: 'KnowledgeAsset',
      symmetric: true,
      transitive: false,
    },
  },
};

describe('OntologyRegistry', () => {
  it('given type when inferClass then maps correctly', () => {
    const reg = new OntologyRegistry();
    reg.load(sample);
    expect(reg.inferClass({ type: 'architecture_design' })).toBe('ArchitectureDesign');
  });

  it('given valid asset when validate then ok', () => {
    resetFactoryCounters();
    const reg = new OntologyRegistry();
    reg.load(sample);
    const asset = createKnowledgeAsset({ type: 'best_practice' });
    expect(reg.validate(asset).valid).toBe(true);
  });
});
