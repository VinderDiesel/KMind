import { describe, expect, it } from 'vitest';
import { createKnowledgeAsset } from '@kmind/shared';
import {
  assessOverviewChildrenDepth,
  assessProjectCoverage,
} from './coverage.js';

function asset(
  partial: Parameters<typeof createKnowledgeAsset>[0] & {
    title: string;
    body: string;
    project?: string;
    related?: string[];
  },
) {
  return createKnowledgeAsset({
    type: 'architecture_design',
    project: 'meta-brain',
    ...partial,
  });
}

const DEEP_BODY = `
## 实现方式
1. 在 \`src/router.ts\` 的 \`routeAsk\` 分流意图到工具；先匹配精确工具，再模糊召回。
2. 失败时回退三层：精确命中 → 模糊 Subgraph → 澄清槽位；每层写 AskTrace。
3. 命令：\`pnpm test router\`；配置键 \`ask.router.fallbackLevels\`。
4. 伪代码：\`if (!tool) return clarify(slots)\`；超时 8s 切断。

## 注意事项
- 并发问数勿复用同一 trace id，否则观测串话。
- 失败时：检查 AskTrace 是否落盘、JOIN 路径是否丢失。
- 边界：无 ontology 时不得跳过澄清直接拼 SQL。

## 红线规避
- 禁止跳过澄清直接生成 SQL。
- 禁止把 S0–S10 整段写进单卡。
- 必须带 project 作用域与代码锚点。

## 代码锚点
- \`src/router.ts\` · \`routeAsk\` · function
- \`src/router.ts\` · \`fallbackClarify\` · function
- \`src/trace/AskTrace.ts\` · \`appendEvent\` · method

额外核对细节：对账用 \`askQuery\` 入口；图表渲染走 \`chartSpec\`；联想召回依赖同义词表与 JOIN 图，缺边时必须澄清而非静默空结果。
`;

describe('assessProjectCoverage', () => {
  it('given only thin overview when assess then incomplete', () => {
    const hub = asset({
      title: '问数系统知识总览',
      body: '## 导航\n- A\n- B\n\n## 红线规避\n- 禁止空总览\n',
      related: [],
    });
    const report = assessProjectCoverage([hub], {
      project: 'meta-brain',
      topic: '问数',
    });
    expect(report.complete).toBe(false);
    expect(report.issues.some((i) => i.code === 'hub_no_children')).toBe(true);
    expect(report.summary).toContain('禁止对外宣称');
  });

  it('given hub with all shallow children when assess then high shallow_child', () => {
    const child = asset({
      title: 'Router 简述',
      body: '总的来说就是路由。简单来说分一下工具。',
      related: [],
    });
    const hub = asset({
      title: '问数系统知识总览',
      body: '## 索引\n见 related\n\n## 注意事项\n- 保持薄\n',
      related: [child.id],
    });
    const report = assessProjectCoverage([hub, child], {
      project: 'meta-brain',
      topic: '问数',
    });
    expect(report.complete).toBe(false);
    expect(
      report.issues.some(
        (i) => i.code === 'shallow_child' && i.severity === 'high',
      ),
    ).toBe(true);
  });

  it('given deep children and hub when assess then complete', () => {
    const c1 = asset({
      title: '问数 Router 分流',
      body: DEEP_BODY,
      related: [],
    });
    const c2 = asset({
      title: '问数 AskTrace',
      body: DEEP_BODY.replace(/routeAsk/g, 'writeTrace').replace(
        /router\.ts/g,
        'trace.ts',
      ),
      related: [],
    });
    const c3 = asset({
      title: '问数 澄清策略',
      body: DEEP_BODY.replace(/routeAsk/g, 'clarify').replace(
        /router\.ts/g,
        'clarify.ts',
      ),
      related: [],
    });
    const hub = asset({
      title: '问数系统知识总览',
      body: '## 导航\n- Router\n- Trace\n- 澄清\n\n## 红线规避\n- 禁止跳过澄清\n',
      related: [c1.id, c2.id, c3.id],
    });
    const report = assessProjectCoverage([hub, c1, c2, c3], {
      project: 'meta-brain',
      topic: '问数',
    });
    expect(report.complete).toBe(true);
    expect(report.nextActions[0]).toContain('覆盖已合格');
  });

  it('given duplicate overview titles when assess then duplicate_overview', () => {
    const a = asset({
      title: '问数系统知识总览',
      body: '## 红线规避\n- x\n\n导航表',
      related: ['k-2026-10-20-001'],
    });
    const b = asset({
      title: '问数系统知识总览',
      body: '## 红线规避\n- y\n\n导航表2',
      related: ['k-2026-10-20-002'],
    });
    // force distinct ids
    Object.assign(a, { id: 'k-2026-10-20-018' });
    Object.assign(b, { id: 'k-2026-10-20-020' });
    const report = assessProjectCoverage([a, b], {
      project: 'meta-brain',
      topic: '问数',
    });
    expect(report.duplicateOverviews.length).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.code === 'duplicate_overview')).toBe(
      true,
    );
  });
});

describe('assessOverviewChildrenDepth', () => {
  it('given all shallow related when gate then rejects', () => {
    const child = asset({
      title: '浅卡',
      body: '很短的总结。',
    });
    const r = assessOverviewChildrenDepth([child.id], (id) =>
      id === child.id ? child : null,
    );
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('禁止仅刷新索引');
  });

  it('given deep related when gate then ok', () => {
    const child = asset({
      title: '深卡',
      body: DEEP_BODY,
    });
    const r = assessOverviewChildrenDepth([child.id], (id) =>
      id === child.id ? child : null,
    );
    expect(r.ok).toBe(true);
  });
});
