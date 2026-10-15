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
});
