import { describe, expect, it } from 'vitest';
import { parseGeneratedCards, parseRepairedCard } from './parse.js';

const EVIDENCE = [
  'packages/core/src/llm/client.ts',
  'packages/core/src/llm/resolve.ts',
];

function content(topic = 'provider 分派'): string {
  return [
    '## 实现方式',
    '',
    `${topic} 由 createLlmClient 按 provider 组装 endpoint / headers / body，`,
    'OpenAI 兼容走 /chat/completions，Anthropic 走 /v1/messages，',
    'Azure 走 deployments 路径，Ollama 走 /api/chat。',
    '错误统一映射为 KMindError(ADAPTER_ERROR)，429/5xx 标记 retryable。',
    '',
    '## 注意事项',
    '',
    'API Key 只从环境变量读取，配置文件只保存 apiKeyEnv 变量名。',
    '',
    '## 红线规避',
    '',
    '禁止把密钥写入 config.yaml；禁止绕过统一错误映射。',
    '',
    '## 代码锚点',
    '',
    '- packages/core/src/llm/client.ts · createLlmClient',
  ].join('\n');
}

function rawCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'LLM 客户端多 provider 分派',
    type: 'architecture_design',
    content: content(),
    anchors: [{ file: 'packages/core/src/llm/client.ts', symbol: 'createLlmClient' }],
    confidence: 0.8,
    ...overrides,
  };
}

describe('parseGeneratedCards', () => {
  it('given fenced envelope when parse then keeps valid card and anchors', () => {
    const raw = `\`\`\`json\n${JSON.stringify({ cards: [rawCard()] })}\n\`\`\``;
    const result = parseGeneratedCards(raw, EVIDENCE);

    expect(result.errors).toEqual([]);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.anchors[0]).toMatchObject({
      file: 'packages/core/src/llm/client.ts',
      symbol: 'createLlmClient',
      confidence: 1,
    });
  });

  it('given anchor outside evidence when parse then drops it and derives from content', () => {
    const result = parseGeneratedCards(
      JSON.stringify({
        cards: [
          rawCard({ anchors: [{ file: 'packages/core/src/llm/unknown.ts' }] }),
        ],
      }),
      EVIDENCE,
    );

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.anchors.map((a) => a.file)).toEqual([
      'packages/core/src/llm/client.ts',
    ]);
  });

  it('given overview-like title when parse then drops the card', () => {
    const result = parseGeneratedCards(
      JSON.stringify({ cards: [rawCard({ title: 'KMind 项目知识总览' })] }),
      EVIDENCE,
    );

    expect(result.cards).toEqual([]);
    expect(result.errors[0]).toContain('总览');
  });

  it('given duplicate titles when parse then keeps only the first', () => {
    const result = parseGeneratedCards(
      JSON.stringify({ cards: [rawCard(), rawCard()] }),
      EVIDENCE,
    );

    expect(result.cards).toHaveLength(1);
    expect(result.errors.some((e) => e.includes('标题重复'))).toBe(true);
  });

  it('given invalid JSON when parse then reports an error', () => {
    const result = parseGeneratedCards('not json at all', EVIDENCE);
    expect(result.cards).toEqual([]);
    expect(result.errors[0]).toContain('JSON');
  });

  it('given schema-invalid card when parse then reports validation error', () => {
    const result = parseGeneratedCards(
      JSON.stringify({ cards: [rawCard({ content: 'too short' })] }),
      EVIDENCE,
    );
    expect(result.cards).toEqual([]);
    expect(result.errors[0]).toContain('校验失败');
  });
});

describe('parseRepairedCard', () => {
  it('given card envelope when parse then returns normalized card', () => {
    const card = parseRepairedCard(
      JSON.stringify({ card: rawCard({ confidence: 0.7 }) }),
      EVIDENCE,
    );

    expect(card?.title).toBe('LLM 客户端多 provider 分派');
    expect(card?.confidence).toBe(0.7);
    expect(card?.anchors).toHaveLength(1);
  });

  it('given overview title when parse then returns null', () => {
    expect(
      parseRepairedCard(
        JSON.stringify({ card: rawCard({ title: '项目知识总览' }) }),
        EVIDENCE,
      ),
    ).toBeNull();
  });

  it('given invalid payload when parse then returns null', () => {
    expect(parseRepairedCard('oops', EVIDENCE)).toBeNull();
  });
});
