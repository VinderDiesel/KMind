import { describe, expect, it } from 'vitest';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { hybridSearch } from './hybrid.js';

describe('hybridSearch', () => {
  it('given multiple channels when fuse then merges matchedBy and scores', () => {
    resetFactoryCounters();
    const a = createKnowledgeAsset({ id: 'k-2026-10-15-001' });
    const b = createKnowledgeAsset({ id: 'k-2026-10-15-002' });
    const results = hybridSearch({
      fulltext: [{ asset: a, score: 1, matchedBy: ['fulltext'] }],
      semantic: [{ asset: a, score: 0.8, matchedBy: ['semantic'] }],
      graph: [{ asset: b, score: 0.5, matchedBy: ['graph'] }],
    });
    expect(results[0]?.asset.id).toBe('k-2026-10-15-001');
    expect(results[0]?.matchedBy).toContain('fulltext');
    expect(results[0]?.matchedBy).toContain('semantic');
    expect(results).toHaveLength(2);
  });
});
