import { describe, expect, it } from 'vitest';
import {
  extractModelIds,
  listLlmModels,
  modelsEndpointFor,
} from './models.js';

describe('modelsEndpointFor', () => {
  it('given ollama base when resolve then returns the tags endpoint', () => {
    expect(modelsEndpointFor('ollama', 'http://127.0.0.1:11434/')).toBe(
      'http://127.0.0.1:11434/api/tags',
    );
  });

  it('given openai base when resolve then appends /models', () => {
    expect(modelsEndpointFor('openai', 'https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/models',
    );
  });

  it('given full chat completions URL when resolve then strips the suffix', () => {
    expect(
      modelsEndpointFor(
        'openai-compatible',
        'https://gateway.example.com/v1/chat/completions',
      ),
    ).toBe('https://gateway.example.com/v1/models');
  });

  it('given anthropic base without version when resolve then adds v1', () => {
    expect(modelsEndpointFor('anthropic', 'https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1/models',
    );
  });

  it('given azure provider when resolve then returns null', () => {
    expect(modelsEndpointFor('azure-openai', 'https://x.openai.azure.com')).toBe(
      null,
    );
  });

  it('given empty base url when resolve then returns null', () => {
    expect(modelsEndpointFor('openai-compatible', '  ')).toBe(null);
  });
});

describe('extractModelIds', () => {
  it('given openai payload when extract then dedupes and sorts data ids', () => {
    expect(
      extractModelIds('openai', {
        data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'gpt-4o' }],
      }),
    ).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('given ollama payload when extract then reads model names', () => {
    expect(
      extractModelIds('ollama', {
        models: [{ name: 'qwen2.5-coder:14b' }, { name: 'llama3.2' }],
      }),
    ).toEqual(['llama3.2', 'qwen2.5-coder:14b']);
  });

  it('given unknown payload when extract then returns empty list', () => {
    expect(extractModelIds('openai', { error: 'nope' })).toEqual([]);
    expect(extractModelIds('openai', null)).toEqual([]);
  });
});

describe('listLlmModels', () => {
  it('given azure provider when list then warns instead of fetching', async () => {
    let called = false;
    const result = await listLlmModels(
      { provider: 'azure-openai', baseUrl: 'https://x.openai.azure.com' },
      (async () => {
        called = true;
        return new Response('{}');
      }) as unknown as typeof fetch,
    );
    expect(called).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.warning).toContain('Azure OpenAI');
  });

  it('given ok response when list then sends bearer and returns ids', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const result = await listLlmModels(
      {
        provider: 'openai-compatible',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'sk-test',
      },
      (async (url: string | URL | Request, init?: RequestInit) => {
        seenUrl = String(url);
        seenAuth = String(
          (init?.headers as Record<string, string> | undefined)?.authorization,
        );
        return new Response(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    );
    expect(seenUrl).toBe('https://gateway.example.com/v1/models');
    expect(seenAuth).toBe('Bearer sk-test');
    expect(result.models).toEqual(['m1', 'm2']);
    expect(result.warning).toBeUndefined();
  });

  it('given keyless gateway when list then omits the authorization header', async () => {
    let seenHeaders: Record<string, string> = {};
    await listLlmModels(
      { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1' },
      (async (_url: string | URL | Request, init?: RequestInit) => {
        seenHeaders = (init?.headers as Record<string, string>) ?? {};
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    );
    expect(seenHeaders.authorization).toBeUndefined();
  });

  it('given http error when list then returns a warning with the status', async () => {
    const result = await listLlmModels(
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1' },
      (async () =>
        new Response('unauthorized', { status: 401 })) as unknown as typeof fetch,
    );
    expect(result.models).toEqual([]);
    expect(result.warning).toContain('401');
  });

  it('given network failure when list then returns a warning instead of throwing', async () => {
    const result = await listLlmModels(
      { provider: 'ollama', baseUrl: 'http://127.0.0.1:1' },
      (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    );
    expect(result.models).toEqual([]);
    expect(result.warning).toContain('ECONNREFUSED');
  });
});
