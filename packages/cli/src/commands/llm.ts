import {
  createLlmClient,
  describeLlmConfig,
  resolveLlmConfig,
  type LlmOverrides,
} from '@kmind/core';
import { KMindError } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { fail, success } from '../exit.js';
import { isInteractive } from '../prompt/interactive.js';
import { persistLlmSettings, type LlmSetOptions } from './llm-settings.js';
import { cmdLlmSetupInteractive } from './llm-interactive.js';

export {
  llmOverridesFromFlags,
  type LlmOverrideFlags,
  type LlmSetOptions,
} from './llm-settings.js';

/**
 * Show the effective provider/model and whether the API key env is present.
 */
export async function cmdLlmStatus(
  ctx: AppContext,
  overrides: LlmOverrides = {},
): Promise<void> {
  const config = await ctx.vault.getConfig();
  const status = describeLlmConfig(config, overrides);
  if (ctx.json) {
    success(status, true);
    return;
  }
  process.stdout.write(
    [
      `[kmind] llm provider=${status.provider} model=${status.model || '(unset)'}`,
      `baseUrl=${status.baseUrl || '(unset)'}`,
      `apiKeyEnv=${status.apiKeyEnv} present=${status.apiKeyPresent}` +
        (status.apiKeySourceEnv ? ` (from ${status.apiKeySourceEnv})` : ''),
      `source=${status.source}`,
      status.jsonMode ? '' : 'jsonMode=false',
      status.azureDeployment
        ? `azureDeployment=${status.azureDeployment}`
        : '',
      status.problem ? `problem=${status.problem}` : 'ok',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  process.stdout.write('\n');
}

/**
 * Persist provider/model settings into vault config.yaml (never the key itself).
 */
export async function cmdLlmSet(
  ctx: AppContext,
  options: LlmSetOptions,
): Promise<void> {
  const hasAny = Object.values(options).some((value) => value !== undefined);
  if (!hasAny) {
    // ADR-005: no flags + TTY → same guided flow as `ocr config provider/model`.
    if (!ctx.json && isInteractive()) {
      await cmdLlmSetupInteractive(ctx);
      return;
    }
    fail(
      new KMindError('llm set 没有提供任何参数', {
        category: 'CONFIG_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion:
          '交互式：`kmind llm provider` / `kmind llm model`；' +
          '非交互：`kmind llm set --provider openai --model gpt-4o-mini`',
      }),
      ctx.json,
    );
  }

  // Validation errors propagate so callers (and tests) keep the KMindError;
  // the CLI action wrapper routes them through fail().
  const result = await persistLlmSettings(ctx, options);
  const status = result.status;
  const payload = {
    ok: true,
    path: result.path,
    llm: status,
    next: status.problem
      ? `补齐配置后运行 kmind llm test：${status.problem}`
      : '运行 kmind llm test 验证连通性',
  };
  if (ctx.json) {
    success(payload, true);
    return;
  }
  process.stdout.write(
    `[kmind] saved llm → ${result.path}\n` +
      `[kmind] provider=${status.provider} model=${status.model || '(unset)'} baseUrl=${status.baseUrl}\n` +
      `[kmind] apiKeyEnv=${status.apiKeyEnv} present=${status.apiKeyPresent}` +
      (status.apiKeyPresent ? '' : '（openai-compatible/ollama 可免 key）') +
      '\n' +
      `[kmind] ${payload.next}\n`,
  );
}

/**
 * One minimal chat round-trip to verify provider/model/key.
 */
export async function cmdLlmTest(
  ctx: AppContext,
  options: { prompt?: string; overrides?: LlmOverrides } = {},
): Promise<void> {
  const config = await ctx.vault.getConfig();
  let resolved: ReturnType<typeof resolveLlmConfig>;
  try {
    resolved = resolveLlmConfig(config, options.overrides);
  } catch (err) {
    fail(err, ctx.json);
  }

  const client = createLlmClient(resolved);
  const prompt = options.prompt?.trim() || '只回复两个字符：OK';
  const started = Date.now();
  let reply: string;
  try {
    reply = await client.chat(
      [
        {
          role: 'system',
          content: 'You are a connectivity probe. Answer briefly.',
        },
        { role: 'user', content: prompt },
      ],
      {
        maxTokens: 32,
        timeoutMs: Math.min(resolved.timeoutMs, 30_000),
      },
    );
  } catch (err) {
    fail(err, ctx.json);
  }

  const payload = {
    ok: true,
    provider: resolved.provider,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    latencyMs: Date.now() - started,
    reply: reply.slice(0, 300),
  };
  if (ctx.json) {
    success(payload, true);
    return;
  }
  process.stdout.write(
    `[kmind] llm ok provider=${payload.provider} model=${payload.model} latency=${payload.latencyMs}ms\n` +
      `[kmind] reply: ${payload.reply}\n`,
  );
}
