import { describe, expect, it } from 'vitest';
import { createKnowledgeAsset, resetFactoryCounters } from '../factories.js';
import { KnowledgeAssetSchema } from './knowledge-asset.schema.js';

describe('KnowledgeAssetSchema', () => {
  it('given valid asset when parse then succeeds', () => {
    resetFactoryCounters();
    const asset = createKnowledgeAsset({ type: 'architecture_design' });
    const result = KnowledgeAssetSchema.safeParse(asset);
    expect(result.success).toBe(true);
  });

  it('given invalid id when parse then fails', () => {
    const asset = createKnowledgeAsset({ id: 'bad-id' });
    const result = KnowledgeAssetSchema.safeParse(asset);
    expect(result.success).toBe(false);
  });

  it('given empty title when parse then fails', () => {
    const asset = createKnowledgeAsset({ title: '' });
    const result = KnowledgeAssetSchema.safeParse(asset);
    expect(result.success).toBe(false);
  });

  it('given confidence out of range when parse then fails', () => {
    const asset = { ...createKnowledgeAsset(), confidence: 1.5 };
    const result = KnowledgeAssetSchema.safeParse(asset);
    expect(result.success).toBe(false);
  });
});
