import { describe, expect, it } from 'vitest';
import { KMindConfigSchema } from './config.schema.js';
import {
  GeneratedKnowledgeCardEnvelopeSchema,
  GeneratedKnowledgeCardSchema,
  LlmConfigSchema,
} from './llm.schema.js';

describe('LlmConfigSchema', () => {
  it('given empty object when parse then applies local-first defaults', () => {
    const parsed = LlmConfigSchema.parse({});
    expect(parsed).toEqual({
      provider: 'ollama',
      model: '',
      baseUrl: '',
      apiKeyEnv: 'KMIND_LLM_API_KEY',
      azureApiVersion: '2024-10-21',
      azureDeployment: '',
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 2048,
      timeoutMs: 120_000,
      maxInputChars: 24_000,
    });
  });

  it('given unknown provider when parse then fails', () => {
    const result = LlmConfigSchema.safeParse({ provider: 'gemini' });
    expect(result.success).toBe(false);
  });

  it('given openai-compatible provider when parse then it is accepted', () => {
    const parsed = LlmConfigSchema.parse({
      provider: 'openai-compatible',
      model: 'deepseek-chat',
      baseUrl: 'https://gateway.example.com/v1',
    });
    expect(parsed.provider).toBe('openai-compatible');
    expect(parsed.baseUrl).toBe('https://gateway.example.com/v1');
    expect(parsed.jsonMode).toBe(true);
  });

  it('given out-of-range sampling values when parse then fails', () => {
    expect(LlmConfigSchema.safeParse({ temperature: 3 }).success).toBe(false);
    expect(LlmConfigSchema.safeParse({ maxTokens: 0 }).success).toBe(false);
    expect(LlmConfigSchema.safeParse({ maxInputChars: 100 }).success).toBe(false);
  });

  it('given minimal vault config when parse then llm block is present', () => {
    const parsed = KMindConfigSchema.parse({
      version: '0.1.0',
      vaultPath: '/tmp/.kmind',
    });
    expect(parsed.llm.provider).toBe('ollama');
    expect(parsed.llm.model).toBe('');
    expect(parsed.llm.apiKeyEnv).toBe('KMIND_LLM_API_KEY');
  });
});

describe('GeneratedKnowledgeCardSchema', () => {
  function card(overrides: Record<string, unknown> = {}) {
    return {
      title: 'LLM 客户端多 provider 分派',
      type: 'architecture_design',
      content: 'x'.repeat(140),
      ...overrides,
    };
  }

  it('given minimal card when parse then defaults anchors and confidence', () => {
    const parsed = GeneratedKnowledgeCardSchema.parse(card());
    expect(parsed.anchors).toEqual([]);
    expect(parsed.confidence).toBe(0.6);
  });

  it('given too-short content or title when parse then fails', () => {
    expect(
      GeneratedKnowledgeCardSchema.safeParse(card({ content: 'short' })).success,
    ).toBe(false);
    expect(
      GeneratedKnowledgeCardSchema.safeParse(card({ title: 'abc' })).success,
    ).toBe(false);
  });

  it('given non-snake-case type when parse then fails', () => {
    expect(
      GeneratedKnowledgeCardSchema.safeParse(card({ type: 'Made Up' })).success,
    ).toBe(false);
  });

  it('given envelope with more than 8 cards when parse then fails', () => {
    const cards = Array.from({ length: 9 }, (_, index) =>
      card({ title: `卡片主题 ${index}` }),
    );
    expect(
      GeneratedKnowledgeCardEnvelopeSchema.safeParse({ cards }).success,
    ).toBe(false);
  });
});
