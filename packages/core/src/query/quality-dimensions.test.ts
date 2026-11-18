import { describe, expect, it } from 'vitest';
import { createKnowledgeAsset } from '@kmind/shared';
import { assessProjectCoverage } from './coverage.js';
import { buildKnowledgeQualityReport } from './quality-dimensions.js';

const DEEP = `
## 实现方式
1. 在 \`packages/core/src/hello.ts\` 的 \`hello\` 保持纯函数无副作用。
2. 调用方 import 使用；禁止平行实现。
3. 配置键与 vault project 必须显式传入。

\`\`\`ts
export function hello(): number { return 1; }
\`\`\`

## 注意事项
- 仅作为实现说明，不要塞协议词。
- 失败时看 quality reasons。

## 红线规避
- **禁止** project=global。
- **禁止**一句话总结冒充实现。
- **禁止**无锚点的架构空文。
`;

describe('buildKnowledgeQualityReport', () => {
  it('given homogeneous details without hub when build then low diversity and coverage', () => {
    const a = createKnowledgeAsset({
      title: 'practice A',
      type: 'best_practice',
      project: 'smoke',
      body: DEEP,
      related: [],
    });
    const b = createKnowledgeAsset({
      title: 'practice B',
      type: 'best_practice',
      project: 'smoke',
      body: DEEP,
      related: [a.id],
    });
    const c = createKnowledgeAsset({
      title: 'practice C',
      type: 'best_practice',
      project: 'smoke',
      body: DEEP,
      related: [a.id],
    });
    const report = assessProjectCoverage([a, b, c], {
      project: 'smoke',
      bootstrap: { tasksDone: 1, tasksTotal: 1 },
    });
    const quality = buildKnowledgeQualityReport(report, [a, b, c]);
    expect(report.complete).toBe(false);
    expect(quality.diversity.score).toBeLessThanOrEqual(40);
    expect(quality.diversity.histogram.best_practice).toBe(3);
    expect(quality.coverage.score).toBeLessThan(80);
    expect(quality.coverage.metrics.hubCount).toBe(0);
  });

  it('given mixed types with hub when build then higher diversity', () => {
    const d1 = createKnowledgeAsset({
      title: 'Router',
      type: 'architecture_design',
      project: 'demo',
      body: `${DEEP}\n## 代码锚点\n- \`packages/core/src/hello.ts\` · hello\n`,
      related: [],
    });
    const d2 = createKnowledgeAsset({
      title: 'CLI tool',
      type: 'tool_usage',
      project: 'demo',
      body: `${DEEP}\n## 代码锚点\n- \`packages/cli/src/index.ts\` · program\n`,
      related: [],
    });
    const d3 = createKnowledgeAsset({
      title: 'JOIN pitfall',
      type: 'pitfall',
      project: 'demo',
      body: `${DEEP}

## 现象
空结果。

## 根因
缺边。

## 正确做法
clarify。
`,
      related: [],
    });
    const hub = createKnowledgeAsset({
      title: 'demo 知识总览',
      type: 'architecture_design',
      project: 'demo',
      body: '## 导航\n- a\n\n## 红线规避\n- 禁止空总览\n',
      related: [d1.id, d2.id, d3.id],
    });
    const report = assessProjectCoverage([hub, d1, d2, d3], {
      project: 'demo',
    });
    const quality = buildKnowledgeQualityReport(report, [hub, d1, d2, d3]);
    expect(quality.diversity.score).toBeGreaterThanOrEqual(60);
    expect(Object.keys(quality.diversity.histogram).length).toBeGreaterThanOrEqual(
      3,
    );
  });
});
