import { describe, expect, it } from 'vitest';
import { HeuristicClassifier } from './classifier.js';

describe('HeuristicClassifier', () => {
  it('given architecture text when classify then returns architecture_design', async () => {
    const c = new HeuristicClassifier();
    const result = await c.classify({
      title: 'Event-driven architecture',
      content: 'We chose microservice event-driven design for payment.',
      rawPath: 'manual/x.md',
    });
    expect(result.type).toBe('architecture_design');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('given pitfall text when classify then returns pitfall', async () => {
    const c = new HeuristicClassifier();
    const result = await c.classify({
      title: 'SQLite gotcha',
      content: '踩坑: foreign keys disabled by default',
      rawPath: 'manual/y.md',
    });
    expect(result.type).toBe('pitfall');
  });

  it('given typeHint when classify then honors hint over heuristics', async () => {
    const c = new HeuristicClassifier();
    const result = await c.classify({
      title: 'Install workflow',
      content: '```bash\npnpm install\n```\n流程规范 for onboarding',
      rawPath: 'manual/z.jsonl',
      typeHint: 'process_spec',
    });
    expect(result.type).toBe('process_spec');
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('given bullet with 方案 when classify then decision uses ## 实现方式 not next redline', async () => {
    const c = new HeuristicClassifier();
    const content = `## 实现方式
1. CLI capture-propose must pass related and anchors into proposal fields.
2. capture-commit writes those fields into raw JSONL for the pipeline.

## 注意事项
- propose does not run the quality gate.

## 红线规避
- **禁止** 用空 project 绕过增量挂图当作长期方案。
- **禁止** 宣称 complete 仅因 capture 成功。
`;
    const result = await c.classify({
      title: 'CLI propose related 透传',
      content,
      rawPath: 'manual/decision-noise.jsonl',
      typeHint: 'best_practice',
    });
    expect(result.context.decision).toContain('capture-propose');
    expect(result.context.decision).not.toContain('宣称 complete');
  });

  it('given ## 决策 heading when classify then decision takes that section', async () => {
    const c = new HeuristicClassifier();
    const result = await c.classify({
      title: 'Choose SQLite',
      content: `## 背景
Need local vault.

## 决策
Use SQLite for index.db with parameterized queries only.

## 权衡
Simpler than Postgres for desktop.
`,
      rawPath: 'manual/decision.md',
      typeHint: 'architecture_design',
    });
    expect(result.context.decision).toContain('SQLite for index.db');
    expect(result.context.problem).toContain('local vault');
  });
});
