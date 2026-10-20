import { describe, expect, it } from 'vitest';
import { extractCodeAnchors, readCodeAnchors } from './code-anchors.js';
import { checkMissingCodeAnchors } from '../health/rules/missing-code-anchors.js';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';

describe('extractCodeAnchors', () => {
  it('given 代码锚点 section when extract then parses bullets', () => {
    const body = [
      '## 决策',
      'Use gate',
      '',
      '## 代码锚点',
      '- `packages/core/src/compiler/pipeline.ts` · `createPipeline` · function',
      '- packages/cli/src/commands/capture.ts · cmdCapture · function',
    ].join('\n');
    const anchors = extractCodeAnchors(body);
    expect(anchors.length).toBe(2);
    expect(anchors[0]?.file).toContain('pipeline.ts');
    expect(anchors[0]?.symbol).toBe('createPipeline');
    expect(anchors[0]?.kind).toBe('function');
  });

  it('given path:line citations when extract then adds line anchors', () => {
    const body = 'See packages/core/src/foo.ts:L42 for the gate.';
    const anchors = extractCodeAnchors(body);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.file).toBe('packages/core/src/foo.ts');
    expect(anchors[0]?.line).toBe(42);
  });

  it('given explicit anchors when extract then merges without dupes', () => {
    const anchors = extractCodeAnchors('## 决策\nok', [
      { file: 'a.ts', symbol: 'x' },
      { file: 'a.ts', symbol: 'x' },
    ]);
    expect(anchors).toHaveLength(1);
  });

  it('given partial anchors when extract then omits undefined keys (YAML-safe)', () => {
    const anchors = extractCodeAnchors('## 决策\nok', [
      { file: 'a.ts', symbol: 'x', kind: 'function' },
    ]);
    expect(anchors).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(anchors[0], 'line')).toBe(
      false,
    );
    expect(
      Object.prototype.hasOwnProperty.call(anchors[0], 'projectPath'),
    ).toBe(false);
    expect(JSON.stringify(anchors[0])).not.toContain('null');
  });
});

describe('checkMissingCodeAnchors', () => {
  it('given architecture without anchors when check then flags low', () => {
    resetFactoryCounters();
    const asset = createKnowledgeAsset({ type: 'architecture_design' });
    const issues = checkMissingCodeAnchors([asset], true);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('missing_code_anchors');
  });

  it('given architecture with anchors when check then silent', () => {
    resetFactoryCounters();
    const asset = createKnowledgeAsset({ type: 'architecture_design' });
    asset.metadata = {
      codeAnchors: [{ file: 'a.ts', symbol: 'f', confidence: 1 }],
    };
    expect(checkMissingCodeAnchors([asset], true)).toHaveLength(0);
    expect(readCodeAnchors(asset.metadata)).toHaveLength(1);
  });

  it('given requireCodeAnchors false when check then skips', () => {
    resetFactoryCounters();
    const asset = createKnowledgeAsset({ type: 'code_snippet' });
    expect(checkMissingCodeAnchors([asset], false)).toHaveLength(0);
  });
});
