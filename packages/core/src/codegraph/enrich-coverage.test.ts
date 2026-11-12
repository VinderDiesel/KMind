import { describe, expect, it } from 'vitest';
import { createKnowledgeAsset } from '@kmind/shared';
import { assessProjectCoverage } from '../query/coverage.js';
import type { CodegraphClient } from './types.js';
import { enrichCoverageSymbols } from './enrich-coverage.js';

const DEEP = `
## 实现方式
1. 在 \`src/router.ts\` 的 \`routeAsk\` 分流。
2. 失败回退；命令 \`pnpm test\`。
3. 伪代码 if (!tool) clarify。
4. 超时 8s。

## 注意事项
- 并发勿复用 trace。
- 失败看 AskTrace。
- 无 ontology 须澄清。

## 红线规避
- 禁止跳过澄清。
- 禁止整段 S0–S10。
- 必须带锚点。

## 代码锚点
- \`src/router.ts\` · \`routeAsk\` · function

额外核对细节：对账与回归样例，避免目录空文。额外核对细节：对账与回归样例。
`;

function mockClient(opts: {
  available?: boolean;
  found?: boolean;
}): CodegraphClient {
  return {
    async isAvailable() {
      return opts.available ?? true;
    },
    async findSymbol() {
      return {
        found: opts.found ?? true,
        matches: opts.found === false ? [] : [{ name: 'routeAsk', filePath: 'src/router.ts' }],
      };
    },
    async listCallers() {
      return [{ name: 'main', filePath: 'src/main.ts' }];
    },
  };
}

describe('enrichCoverageSymbols', () => {
  it('given symbol missing when enrich then broken_anchor_symbol', async () => {
    const child = createKnowledgeAsset({
      title: '问数 Router',
      type: 'architecture_design',
      project: 'p',
      body: DEEP,
    });
    const hub = createKnowledgeAsset({
      title: '问数总览',
      type: 'architecture_design',
      project: 'p',
      related: [child.id],
      body: '## 红线规避\n- x\n\nnav',
    });
    const base = assessProjectCoverage([hub, child], {
      project: 'p',
      topic: '问数',
      exists: () => true,
      codeRoot: '/tmp',
    });
    // may still be incomplete for other reasons; force-clear blocking except we care about enrich add
    const enriched = await enrichCoverageSymbols(base, {
      client: mockClient({ found: false }),
      projectPath: '/tmp',
      scopedAssets: [hub, child],
    });
    expect(
      enriched.report.issues.some((i) => i.code === 'broken_anchor_symbol'),
    ).toBe(true);
    expect(enriched.report.complete).toBe(false);
  });

  it('given unavailable and required when enrich then codegraph_required_unavailable', async () => {
    const child = createKnowledgeAsset({
      title: '问数 Router',
      type: 'architecture_design',
      project: 'p',
      body: DEEP,
    });
    const base = assessProjectCoverage([child], {
      project: 'p',
      exists: () => true,
      codeRoot: '/tmp',
    });
    const enriched = await enrichCoverageSymbols(base, {
      client: mockClient({ available: false }),
      projectPath: '/tmp',
      required: true,
      scopedAssets: [child],
    });
    expect(
      enriched.report.issues.some(
        (i) => i.code === 'codegraph_required_unavailable',
      ),
    ).toBe(true);
    expect(enriched.codegraphAvailable).toBe(false);
  });

  it('given broken_anchor_path when enrich then skips symbol check', async () => {
    const child = createKnowledgeAsset({
      title: '问数 Router',
      type: 'architecture_design',
      project: 'p',
      body: DEEP,
    });
    const base = assessProjectCoverage([child], {
      project: 'p',
      exists: () => false,
      codeRoot: '/tmp',
    });
    expect(base.issues.some((i) => i.code === 'broken_anchor_path')).toBe(true);
    const enriched = await enrichCoverageSymbols(base, {
      client: mockClient({ found: false }),
      projectPath: '/tmp',
      scopedAssets: [child],
    });
    expect(
      enriched.report.issues.some((i) => i.code === 'broken_anchor_symbol'),
    ).toBe(false);
  });
});
