import { KMindConfigSchema, KMindError, type KMindConfig } from '@kmind/shared';
import { describe, expect, it } from 'vitest';
import {
  describeLlmConfig,
  resolveLlmConfig,
  resolveLlmConfigOptional,
} from './resolve.js';

function config(llm: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): KMindConfig {
  return KMindConfigSchema.parse({
    version: '0.1.0',
    vaultPath: '/tmp/.kmind',
    llm,
    ...extra,
  });
}

describe('resolveLlmConfig', () => {
  it('given openai config when resolve then uses provider baseUrl and fallback env key', () => {
    const resolved = resolveLlmConfig(
      config({ provider: 'openai', model: 'gpt-4o-mini' }),
      {},
      { OPENAI_API_KEY: 'sk-test' },
    );

    expect(resolved.provider).toBe('openai');
    expect(resolved.model).toBe('gpt-4o-mini');
    expect(resolved.baseUrl).toBe('https://api.openai.com/v1');
    expect(resolved.apiKey).toBe('sk-test');
    expect(resolved.apiKeySourceEnv).toBe('OPENAI_API_KEY');
    expect(resolved.source).toBe('config');
  });

  it('given missing model when resolve then throws CONFIG_ERROR', () => {
    expect(() => resolveLlmConfig(config(), {}, {})).toThrow(KMindError);
    try {
      resolveLlmConfig(config(), {}, {});
    } catch (err) {
      expect((err as KMindError).category).toBe('CONFIG_ERROR');
    }
  });

  it('given anthropic without any key when resolve then throws CONFIG_ERROR', () => {
    expect(() =>
      resolveLlmConfig(
        config({ provider: 'anthropic', model: 'claude-sonnet-4-5' }),
        {},
        {},
      ),
    ).toThrow(/API Key/);
  });

  it('given azure without baseUrl when resolve then throws CONFIG_ERROR', () => {
    expect(() =>
      resolveLlmConfig(
        config({ provider: 'azure-openai', model: 'gpt-4o' }),
        {},
        { AZURE_OPENAI_API_KEY: 'k' },
      ),
    ).toThrow(/base-url/);
  });

  it('given azure with baseUrl when resolve then deployment falls back to model', () => {
    const resolved = resolveLlmConfig(
      config({
        provider: 'azure-openai',
        model: 'gpt-4o',
        baseUrl: 'https://acme.openai.azure.com/',
      }),
      {},
      { KMIND_LLM_API_KEY: 'k' },
    );
    expect(resolved.baseUrl).toBe('https://acme.openai.azure.com');
    expect(resolved.azureDeployment).toBe('gpt-4o');
  });

  it('given openai-compatible without baseUrl when resolve then throws with hint', () => {
    expect(() =>
      resolveLlmConfig(
        config({ provider: 'openai-compatible', model: 'qwen2.5-72b' }),
        {},
        {},
      ),
    ).toThrow(/需要自定义 --base-url/);
  });

  it('given openai-compatible with baseUrl and no key when resolve then succeeds', () => {
    const resolved = resolveLlmConfig(
      config({
        provider: 'openai-compatible',
        model: 'qwen2.5-72b',
        baseUrl: 'https://gateway.example.com/v1/',
      }),
      {},
      {},
    );

    expect(resolved.provider).toBe('openai-compatible');
    expect(resolved.baseUrl).toBe('https://gateway.example.com/v1');
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.jsonMode).toBe(true);
  });

  it('given jsonMode false in config when resolve then it is carried over', () => {
    const resolved = resolveLlmConfig(
      config({
        provider: 'openai-compatible',
        model: 'm',
        baseUrl: 'http://127.0.0.1:8000/v1',
        jsonMode: false,
      }),
      {},
      {},
    );

    expect(resolved.jsonMode).toBe(false);
  });

  it('given legacy bootstrap llm when resolve then uses ollama endpoint', () => {
    const resolved = resolveLlmConfig(
      config(
        {},
        {
          bootstrap: {
            llm: {
              endpoint: 'http://127.0.0.1:11434',
              model: 'qwen2.5-coder:14b',
              timeoutMs: 15_000,
            },
          },
        },
      ),
      {},
      {},
    );

    expect(resolved.source).toBe('legacy-bootstrap');
    expect(resolved.provider).toBe('ollama');
    expect(resolved.model).toBe('qwen2.5-coder:14b');
    expect(resolved.baseUrl).toBe('http://127.0.0.1:11434');
    expect(resolved.timeoutMs).toBe(15_000);
  });

  it('given CLI overrides when resolve then overrides win over config', () => {
    const resolved = resolveLlmConfig(
      config({ provider: 'ollama', model: 'old' }),
      {
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: 'https://proxy.example.com/v1',
        apiKeyEnv: 'CUSTOM_KEY',
        maxInputChars: 8_000,
      },
      { CUSTOM_KEY: 'custom' },
    );

    expect(resolved.provider).toBe('openai');
    expect(resolved.model).toBe('gpt-4o');
    expect(resolved.baseUrl).toBe('https://proxy.example.com/v1');
    expect(resolved.apiKey).toBe('custom');
    expect(resolved.maxInputChars).toBe(8_000);
  });

  it('given unresolvable config when optional then returns null', () => {
    expect(resolveLlmConfigOptional(config(), {}, {})).toBeNull();
  });
});

describe('describeLlmConfig', () => {
  it('given missing key when describe then reports problem without exposing secrets', () => {
    const status = describeLlmConfig(
      config({ provider: 'openai', model: 'gpt-4o-mini' }),
      {},
      {},
    );

    expect(status.configured).toBe(false);
    expect(status.apiKeyPresent).toBe(false);
    expect(status.problem).toContain('KMIND_LLM_API_KEY');
    expect(JSON.stringify(status)).not.toContain('sk-');
  });

  it('given complete config when describe then configured true', () => {
    const status = describeLlmConfig(
      config({ provider: 'openai', model: 'gpt-4o-mini' }),
      {},
      { KMIND_LLM_API_KEY: 'secret' },
    );

    expect(status.configured).toBe(true);
    expect(status.baseUrl).toBe('https://api.openai.com/v1');
    expect(status.problem).toBeUndefined();
  });

  it('given openai-compatible without baseUrl when describe then reports problem', () => {
    const status = describeLlmConfig(
      config({ provider: 'openai-compatible', model: 'm' }),
      {},
      {},
    );

    expect(status.configured).toBe(false);
    expect(status.problem).toContain('baseUrl');
  });

  it('given openai-compatible without key when describe then still configured', () => {
    const status = describeLlmConfig(
      config({
        provider: 'openai-compatible',
        model: 'm',
        baseUrl: 'http://127.0.0.1:8000/v1',
      }),
      {},
      {},
    );

    expect(status.configured).toBe(true);
    expect(status.apiKeyPresent).toBe(false);
  });
});
