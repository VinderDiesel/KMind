import { KMindError } from '@kmind/shared';
import { describe, expect, it } from 'vitest';
import { createLlmClient } from './client.js';
import type { ResolvedLlmConfig } from './types.js';

interface Captured {
  url: string;
  init: RequestInit;
}

function resolved(
  overrides: Partial<ResolvedLlmConfig> = {},
): ResolvedLlmConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    apiKeyEnv: 'KMIND_LLM_API_KEY',
    azureApiVersion: '2024-10-21',
    azureDeployment: '',
    jsonMode: true,
    temperature: 0.2,
    maxTokens: 2048,
    timeoutMs: 5_000,
    maxInputChars: 24_000,
    source: 'config',
    ...overrides,
  };
}

function fakeFetch(payload: unknown, status = 200): {
  fetchImpl: typeof fetch;
  captured: Captured[];
} {
  const captured: Captured[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, captured };
}

function bodyOf(captured: Captured): Record<string, unknown> {
  return JSON.parse(String(captured.init.body)) as Record<string, unknown>;
}

describe('createLlmClient', () => {
  it('given openai when chat then posts to /chat/completions with bearer key', async () => {
    const { fetchImpl, captured } = fakeFetch({
      choices: [{ message: { content: 'hello' } }],
    });
    const client = createLlmClient(resolved(), fetchImpl);

    const reply = await client.chat([{ role: 'user', content: 'hi' }], {
      json: true,
    });

    expect(reply).toBe('hello');
    expect(captured[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    const body = bodyOf(captured[0]!);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('given anthropic when chat then separates system and uses x-api-key', async () => {
    const { fetchImpl, captured } = fakeFetch({
      content: [{ type: 'text', text: 'part-a' }, { type: 'text', text: 'part-b' }],
    });
    const client = createLlmClient(
      resolved({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'ant-key',
      }),
      fetchImpl,
    );

    const reply = await client.chat([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);

    expect(reply).toBe('part-apart-b');
    expect(captured[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('ant-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = bodyOf(captured[0]!);
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('given azure when chat then uses deployment path and api-key header', async () => {
    const { fetchImpl, captured } = fakeFetch({
      choices: [{ message: { content: 'azure-ok' } }],
    });
    const client = createLlmClient(
      resolved({
        provider: 'azure-openai',
        model: 'gpt-4o',
        baseUrl: 'https://acme.openai.azure.com',
        azureDeployment: 'prod-gpt4o',
        apiKey: 'az-key',
      }),
      fetchImpl,
    );

    await client.chat([{ role: 'user', content: 'hi' }]);

    expect(captured[0]?.url).toBe(
      'https://acme.openai.azure.com/openai/deployments/prod-gpt4o/chat/completions?api-version=2024-10-21',
    );
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('az-key');
  });

  it('given ollama when chat then posts /api/chat without auth and with format json', async () => {
    const { fetchImpl, captured } = fakeFetch({
      message: { content: 'local-ok' },
    });
    const client = createLlmClient(
      resolved({
        provider: 'ollama',
        model: 'qwen2.5-coder:14b',
        baseUrl: 'http://127.0.0.1:11434',
        apiKey: undefined,
      }),
      fetchImpl,
    );

    const reply = await client.chat([{ role: 'user', content: 'hi' }], {
      json: true,
    });

    expect(reply).toBe('local-ok');
    expect(captured[0]?.url).toBe('http://127.0.0.1:11434/api/chat');
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(bodyOf(captured[0]!).format).toBe('json');
  });

  it('given openai-compatible gateway when chat then posts to its /v1 endpoint', async () => {
    const { fetchImpl, captured } = fakeFetch({
      choices: [{ message: { content: 'gw-ok' } }],
    });
    const client = createLlmClient(
      resolved({
        provider: 'openai-compatible',
        model: 'deepseek-chat',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'gw-key',
      }),
      fetchImpl,
    );

    const reply = await client.chat([{ role: 'user', content: 'hi' }], {
      json: true,
    });

    expect(reply).toBe('gw-ok');
    expect(captured[0]?.url).toBe(
      'https://gateway.example.com/v1/chat/completions',
    );
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer gw-key');
    expect(bodyOf(captured[0]!).response_format).toEqual({
      type: 'json_object',
    });
  });

  it('given full completions URL when chat then it is used as-is', async () => {
    const { fetchImpl, captured } = fakeFetch({
      choices: [{ message: { content: 'full' } }],
    });
    const client = createLlmClient(
      resolved({
        provider: 'openai-compatible',
        model: 'local',
        baseUrl: 'http://127.0.0.1:8000/v1/chat/completions',
        apiKey: undefined,
      }),
      fetchImpl,
    );

    await client.chat([{ role: 'user', content: 'hi' }]);

    expect(captured[0]?.url).toBe(
      'http://127.0.0.1:8000/v1/chat/completions',
    );
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it('given jsonMode false when chat then response_format is omitted', async () => {
    const { fetchImpl, captured } = fakeFetch({
      choices: [{ message: { content: 'plain' } }],
    });
    const client = createLlmClient(
      resolved({ provider: 'openai-compatible', jsonMode: false }),
      fetchImpl,
    );

    await client.chat([{ role: 'user', content: 'hi' }], { json: true });

    expect(bodyOf(captured[0]!).response_format).toBeUndefined();
  });

  it('given 404 from a wrong base URL when chat then suggests baseUrl and json mode', async () => {
    const { fetchImpl } = fakeFetch({ error: 'not found' }, 404);
    const client = createLlmClient(resolved(), fetchImpl);

    await expect(
      client.chat([{ role: 'user', content: 'hi' }]),
    ).rejects.toMatchObject({
      category: 'ADAPTER_ERROR',
      retryable: false,
    });
    try {
      await client.chat([{ role: 'user', content: 'hi' }]);
    } catch (err) {
      expect((err as KMindError).suggestion).toContain('json-mode');
    }
  });

  it('given 401 when chat then throws non-retryable ADAPTER_ERROR', async () => {
    const { fetchImpl } = fakeFetch({ error: 'bad key' }, 401);
    const client = createLlmClient(resolved(), fetchImpl);

    await expect(
      client.chat([{ role: 'user', content: 'hi' }]),
    ).rejects.toMatchObject({
      category: 'ADAPTER_ERROR',
      retryable: false,
    });
  });

  it('given 503 when chat then throws retryable ADAPTER_ERROR', async () => {
    const { fetchImpl } = fakeFetch({ error: 'busy' }, 503);
    const client = createLlmClient(resolved(), fetchImpl);

    try {
      await client.chat([{ role: 'user', content: 'hi' }]);
      expect.unreachable('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(KMindError);
      expect((err as KMindError).retryable).toBe(true);
    }
  });

  it('given empty completion when chat then throws', async () => {
    const { fetchImpl } = fakeFetch({ choices: [{ message: { content: '' } }] });
    const client = createLlmClient(resolved(), fetchImpl);

    await expect(
      client.chat([{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/空内容/);
  });

  it('given network failure when chat then throws retryable ADAPTER_ERROR', async () => {
    const fetchImpl = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;
    const client = createLlmClient(resolved(), fetchImpl);

    try {
      await client.chat([{ role: 'user', content: 'hi' }]);
      expect.unreachable('expected throw');
    } catch (err) {
      expect((err as KMindError).category).toBe('ADAPTER_ERROR');
      expect((err as KMindError).retryable).toBe(true);
    }
  });
});
