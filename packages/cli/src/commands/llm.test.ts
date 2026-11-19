import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAssetTypeRegistry,
  createVault,
  OntologyEvolver,
  OntologyRegistry,
  SqliteStore,
} from '@kmind/core';
import { KMindError } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { cmdLlmSet, cmdLlmStatus, llmOverridesFromFlags } from './llm.js';

describe('llm commands', () => {
  let dir: string;
  let store: SqliteStore;
  let ctx: AppContext;
  let origWrite: typeof process.stdout.write;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-llm-'));
    const vault = createVault(path.join(dir, '.kmind-knowledge'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    const evolver = new OntologyEvolver(vault.ontologyDir, registry);
    const assetTypes = await createAssetTypeRegistry(vault.assetTypesDir);
    ctx = {
      vault,
      store,
      registry,
      evolver,
      assetTypes,
      adapters: [],
      json: true,
    };
    origWrite = process.stdout.write.bind(process.stdout);
  });

  afterEach(() => {
    process.stdout.write = origWrite;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function captureOutput(run: () => Promise<void>): Promise<string> {
    const chunks: Buffer[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await run();
    } finally {
      process.stdout.write = origWrite;
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  it('given set flags when persist then config keeps apiKeyEnv but never the key', async () => {
    await captureOutput(() =>
      cmdLlmSet(ctx, {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKeyEnv: 'OPENAI_API_KEY',
        temperature: '0.1',
        maxTokens: '1024',
      }),
    );

    const config = await ctx.vault.getConfig();
    expect(config.llm.provider).toBe('openai');
    expect(config.llm.model).toBe('gpt-4o-mini');
    expect(config.llm.apiKeyEnv).toBe('OPENAI_API_KEY');
    expect(config.llm.temperature).toBe(0.1);
    expect(config.llm.maxTokens).toBe(1024);

    const raw = readFileSync(ctx.vault.configPath, 'utf8');
    expect(raw).toContain('apiKeyEnv: OPENAI_API_KEY');
    expect(raw).not.toContain('sk-');
  });

  it('given invalid temperature when set then throws CONFIG_ERROR', async () => {
    await expect(
      captureOutput(() => cmdLlmSet(ctx, { temperature: '9' })),
    ).rejects.toBeInstanceOf(KMindError);
  });

  it('given no flags when set then reports a usage error', async () => {
    const exit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? ''}`);
    }) as typeof process.exit;
    try {
      await expect(captureOutput(() => cmdLlmSet(ctx, {}))).rejects.toThrow(
        /exit:/,
      );
    } finally {
      process.exit = exit;
    }
  });

  it('given openai-compatible when set then custom baseUrl is persisted', async () => {
    await captureOutput(() =>
      cmdLlmSet(ctx, {
        provider: 'openai-compatible',
        model: 'qwen2.5-72b-instruct',
        baseUrl: ' https://gateway.example.com/v1/ ',
        apiKeyEnv: 'GATEWAY_KEY',
      }),
    );

    const config = await ctx.vault.getConfig();
    expect(config.llm.provider).toBe('openai-compatible');
    expect(config.llm.model).toBe('qwen2.5-72b-instruct');
    expect(config.llm.baseUrl).toBe('https://gateway.example.com/v1');
    expect(config.llm.apiKeyEnv).toBe('GATEWAY_KEY');
  });

  it('given openai-compatible without baseUrl when set then fails fast', async () => {
    const error = await captureOutput(() =>
      cmdLlmSet(ctx, {
        provider: 'openai-compatible',
        model: 'qwen2.5-72b-instruct',
      }),
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(KMindError);
    expect((error as KMindError).message).toContain(
      'openai-compatible 需要 --base-url',
    );
    const config = await ctx.vault.getConfig();
    expect(config.llm.provider).toBe('ollama');
  });

  it('given non-http baseUrl when set then throws CONFIG_ERROR', async () => {
    await expect(
      captureOutput(() => cmdLlmSet(ctx, { baseUrl: 'ftp://example.com' })),
    ).rejects.toBeInstanceOf(KMindError);
  });

  it('given json-mode flag when build overrides then boolean is parsed', () => {
    expect(llmOverridesFromFlags({ jsonMode: 'false' }).jsonMode).toBe(false);
    expect(() => llmOverridesFromFlags({ jsonMode: 'nope' })).toThrow(
      /--json-mode/,
    );
  });

  it('given unset model when status then reports configured false', async () => {
    const payload = JSON.parse(
      await captureOutput(() => cmdLlmStatus(ctx)),
    ) as {
      configured: boolean;
      provider: string;
      apiKeyEnv: string;
      problem?: string;
    };

    expect(payload.configured).toBe(false);
    expect(payload.provider).toBe('ollama');
    expect(payload.apiKeyEnv).toBe('KMIND_LLM_API_KEY');
    expect(payload.problem).toContain('model');
  });

  it('given invalid provider flag when build overrides then throws', () => {
    expect(() => llmOverridesFromFlags({ provider: 'gemini' })).toThrow(
      /不支持的 provider/,
    );
  });

  it('given provider flag when build overrides then trims values', () => {
    expect(
      llmOverridesFromFlags({
        provider: ' openai ',
        model: ' gpt-4o ',
        baseUrl: ' https://x/v1 ',
        apiKeyEnv: ' K ',
      }),
    ).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: 'https://x/v1',
      apiKeyEnv: 'K',
    });
  });
});
