import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAssetTypeRegistry,
  createVault,
  OntologyEvolver,
  OntologyRegistry,
  SqliteStore,
  type LlmModelListResult,
} from '@kmind/core';
import type { AppContext } from '../context.js';
import type { SelectChoice } from '../prompt/interactive.js';
import {
  cmdLlmModelInteractive,
  cmdLlmProviderInteractive,
  type LlmPrompter,
} from './llm-interactive.js';

interface PromptScript {
  select?: unknown[];
  text?: string[];
  confirm?: boolean[];
}

/** Scripted prompter: pops one answer per call and records the prompts. */
function scripted(script: PromptScript): {
  prompter: LlmPrompter;
  messages: string[];
} {
  const messages: string[] = [];
  const select = [...(script.select ?? [])];
  const text = [...(script.text ?? [])];
  const confirm = [...(script.confirm ?? [])];
  return {
    messages,
    prompter: {
      async select<T>(message: string, _choices: SelectChoice<T>[]) {
        messages.push(`select:${message}`);
        const next = select.shift();
        return (next ?? null) as T | null;
      },
      async text(message: string) {
        messages.push(`text:${message}`);
        return text.shift() ?? null;
      },
      async confirm(message: string) {
        messages.push(`confirm:${message}`);
        return confirm.shift() ?? false;
      },
    },
  };
}

describe('llm interactive commands', () => {
  let dir: string;
  let store: SqliteStore;
  let ctx: AppContext;
  let origWrite: typeof process.stdout.write;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-llm-ia-'));
    const vault = createVault(path.join(dir, '.kmind-knowledge'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
    ctx = {
      vault,
      store,
      registry: new OntologyRegistry(),
      evolver: new OntologyEvolver(vault.ontologyDir, new OntologyRegistry()),
      assetTypes: await createAssetTypeRegistry(vault.assetTypesDir),
      adapters: [],
      json: false,
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

  it('given custom gateway answers when provider wizard then config is persisted', async () => {
    const { prompter, messages } = scripted({
      select: ['openai-compatible'],
      text: ['https://gateway.example.com/v1'],
      confirm: [false, false, false],
    });
    const out = await captureOutput(() =>
      cmdLlmProviderInteractive(ctx, prompter),
    );

    const config = await ctx.vault.getConfig();
    expect(config.llm.provider).toBe('openai-compatible');
    expect(config.llm.baseUrl).toBe('https://gateway.example.com/v1');
    expect(config.llm.jsonMode).toBe(false);
    expect(messages[0]).toContain('provider');
    expect(out).toContain('provider 已保存');
    expect(out).toContain('kmind llm model');
  });

  it('given keyed gateway answers when provider wizard then asks key env name', async () => {
    const { prompter } = scripted({
      select: ['openai'],
      text: ['OPENAI_API_KEY'],
      confirm: [false],
    });
    await captureOutput(() => cmdLlmProviderInteractive(ctx, prompter));

    const config = await ctx.vault.getConfig();
    expect(config.llm.provider).toBe('openai');
    expect(config.llm.baseUrl).toBe('');
    expect(config.llm.apiKeyEnv).toBe('OPENAI_API_KEY');
  });

  it('given cancel at provider list when wizard then nothing is saved', async () => {
    const { prompter } = scripted({ select: [null] });
    const out = await captureOutput(() =>
      cmdLlmProviderInteractive(ctx, prompter),
    );

    const config = await ctx.vault.getConfig();
    expect(config.llm.provider).toBe('ollama');
    expect(out).toContain('已取消');
  });

  it('given listed models when model picker then saves the picked id', async () => {
    await ctx.vault.saveConfig({
      ...(await ctx.vault.getConfig()),
      llm: {
        ...(await ctx.vault.getConfig()).llm,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: '',
      },
    });
    const { prompter, messages } = scripted({ select: ['gpt-4o-mini'] });
    const out = await captureOutput(() =>
      cmdLlmModelInteractive(ctx, prompter, async () => ({
        models: ['gpt-4o', 'gpt-4o-mini'],
      })),
    );

    const config = await ctx.vault.getConfig();
    expect(config.llm.model).toBe('gpt-4o-mini');
    expect(messages.some((line) => line.startsWith('select:'))).toBe(true);
    expect(out).toContain('model 已保存');
  });

  it('given empty listing when model picker then falls back to manual input', async () => {
    const { prompter, messages } = scripted({ text: ['my-local-model'] });
    const out = await captureOutput(() =>
      cmdLlmModelInteractive(ctx, prompter, async (): Promise<LlmModelListResult> => ({
        models: [],
        warning: '获取模型列表失败（HTTP 404）',
      })),
    );

    const config = await ctx.vault.getConfig();
    expect(config.llm.model).toBe('my-local-model');
    expect(out).toContain('获取模型列表失败');
    expect(messages.some((line) => line.startsWith('text:'))).toBe(true);
  });

  it('given manual choice in listing when model picker then asks for text', async () => {
    const { prompter } = scripted({
      select: ['__manual__'],
      text: ['deepseek-chat'],
    });
    await captureOutput(() =>
      cmdLlmModelInteractive(ctx, prompter, async () => ({
        models: ['other-model'],
      })),
    );

    const config = await ctx.vault.getConfig();
    expect(config.llm.model).toBe('deepseek-chat');
  });

  it('given missing baseUrl when model picker then reports a config error', async () => {
    const config = await ctx.vault.getConfig();
    await ctx.vault.saveConfig({
      ...config,
      llm: { ...config.llm, provider: 'openai-compatible', baseUrl: '' },
    });
    const { prompter } = scripted({});
    const exit = process.exit;
    const origStderr = process.stderr.write.bind(process.stderr);
    const chunks: Buffer[] = [];
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? ''}`);
    }) as typeof process.exit;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      await captureOutput(() => cmdLlmModelInteractive(ctx, prompter));
      expect.unreachable('expected fail()');
    } catch (err) {
      expect((err as Error).message).toMatch(/^exit:/);
    } finally {
      process.exit = exit;
      process.stderr.write = origStderr;
    }
    expect(Buffer.concat(chunks).toString('utf8')).toContain(
      'kmind llm provider',
    );
  });

  it('given --json when provider wizard then refuses interactive mode', async () => {
    ctx.json = true;
    const { prompter } = scripted({});
    const exit = process.exit;
    const origStderr = process.stderr.write.bind(process.stderr);
    const chunks: Buffer[] = [];
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? ''}`);
    }) as typeof process.exit;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      await cmdLlmProviderInteractive(ctx, prompter);
      expect.unreachable('expected fail()');
    } catch (err) {
      expect((err as Error).message).toMatch(/^exit:/);
    } finally {
      process.exit = exit;
      process.stderr.write = origStderr;
    }
    expect(Buffer.concat(chunks).toString('utf8')).toContain(
      '交互式配置不支持 --json',
    );
  });
});
