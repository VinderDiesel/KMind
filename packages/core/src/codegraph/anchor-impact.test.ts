import { describe, expect, it } from 'vitest';
import { createKnowledgeAsset } from '@kmind/shared';
import { buildAnchorImpact, findCoCiting } from './anchor-impact.js';
import type { CodegraphClient } from './types.js';

describe('findCoCiting', () => {
  it('given peer with same file|symbol when find then returns peer', () => {
    const focus = createKnowledgeAsset({
      id: 'k-2026-11-12-001',
      title: 'focus',
      project: 'p',
      body: '## 代码锚点\n- `a.ts` · `foo` · function\n',
    });
    const peer = createKnowledgeAsset({
      id: 'k-2026-11-12-002',
      title: 'peer',
      project: 'p',
      type: 'pitfall',
      body: '## 代码锚点\n- `a.ts` · `foo` · function\n',
    });
    const hits = findCoCiting([focus, peer], focus.id, 'a.ts', 'foo', 5);
    expect(hits).toEqual([
      { id: peer.id, title: 'peer', type: 'pitfall' },
    ]);
  });
});

describe('buildAnchorImpact', () => {
  it('given available client when build then includes callers and coCiting', async () => {
    const focus = createKnowledgeAsset({
      id: 'k-2026-11-12-010',
      title: 'focus',
      project: 'p',
      body: 'x',
    });
    const peer = createKnowledgeAsset({
      id: 'k-2026-11-12-011',
      title: 'peer',
      project: 'p',
      type: 'best_practice',
      body: '## 代码锚点\n- `src/a.ts` · `bar` · function\n',
    });
    const client: CodegraphClient = {
      async isAvailable() {
        return true;
      },
      async findSymbol() {
        return {
          found: true,
          matches: [{ name: 'bar', filePath: 'src/a.ts' }],
        };
      },
      async listCallers() {
        return [{ name: 'main', filePath: 'src/main.ts', kind: 'function' }];
      },
    };
    const impact = await buildAnchorImpact({
      client,
      projectPath: '/tmp',
      focus,
      anchors: [{ file: 'src/a.ts', symbol: 'bar', confidence: 1 }],
      projectAssets: [focus, peer],
    });
    expect(impact).toHaveLength(1);
    expect(impact[0]!.symbolFound).toBe(true);
    expect(impact[0]!.callers[0]?.name).toBe('main');
    expect(impact[0]!.coCiting[0]?.id).toBe(peer.id);
  });
});
