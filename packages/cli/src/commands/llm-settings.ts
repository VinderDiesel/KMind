import { describeLlmConfig, type LlmConfigStatus, type LlmOverrides } from '@kmind/core';
import { LlmProviderEnum, KMindError, type LlmConfig } from '@kmind/shared';
import type { AppContext } from '../context.js';

/** Flags accepted by `kmind llm set` (all optional, merged into config). */
export interface LlmSetOptions {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  azureApiVersion?: string;
  azureDeployment?: string;
  jsonMode?: string;
  temperature?: string;
  maxTokens?: string;
  timeoutMs?: string;
  maxInputChars?: string;
}

/** Flags shared by `llm status` / `llm test` for one-off overrides. */
export interface LlmOverrideFlags {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  jsonMode?: string;
}

/** Providers accepted by `--provider` (ADR-005). */
export const PROVIDER_CHOICES =
  'ollama | openai | openai-compatible | anthropic | azure-openai';

export interface LlmPersistResult {
  status: LlmConfigStatus;
  path: string;
}

/**
 * Validate provider flags into LlmOverrides (throws CONFIG_ERROR on bad provider).
 */
export function llmOverridesFromFlags(flags: LlmOverrideFlags): LlmOverrides {
  const overrides: LlmOverrides = {};
  if (flags.provider?.trim()) {
    overrides.provider = parseProvider(flags.provider);
  }
  if (flags.model?.trim()) overrides.model = flags.model.trim();
  if (flags.baseUrl?.trim()) overrides.baseUrl = normalizeBaseUrl(flags.baseUrl);
  if (flags.apiKeyEnv?.trim()) {
    overrides.apiKeyEnv = flags.apiKeyEnv.trim();
  }
  if (flags.jsonMode !== undefined) {
    overrides.jsonMode = parseBoolean(flags.jsonMode, '--json-mode');
  }
  return overrides;
}

/**
 * Merge options into the stored llm block and persist it (never the key itself).
 * Throws KMindError instead of exiting so wizards and commands can share it.
 */
export async function persistLlmSettings(
  ctx: AppContext,
  options: LlmSetOptions,
): Promise<LlmPersistResult> {
  const config = await ctx.vault.getConfig();
  const next: LlmConfig = { ...config.llm };

  if (options.provider !== undefined) {
    next.provider = parseProvider(options.provider);
  }
  if (options.model !== undefined) next.model = options.model.trim();
  if (options.baseUrl !== undefined) {
    next.baseUrl = normalizeBaseUrl(options.baseUrl);
  }
  if (options.apiKeyEnv !== undefined) {
    next.apiKeyEnv = options.apiKeyEnv.trim();
  }
  if (options.azureApiVersion !== undefined) {
    next.azureApiVersion = options.azureApiVersion.trim();
  }
  if (options.azureDeployment !== undefined) {
    next.azureDeployment = options.azureDeployment.trim();
  }
  if (options.jsonMode !== undefined) {
    next.jsonMode = parseBoolean(options.jsonMode, '--json-mode');
  }
  if (options.temperature !== undefined) {
    next.temperature = parseNumber(options.temperature, '--temperature', 0, 2);
  }
  if (options.maxTokens !== undefined) {
    next.maxTokens = parseInteger(options.maxTokens, '--max-tokens', 1, 32_768);
  }
  if (options.timeoutMs !== undefined) {
    next.timeoutMs = parseInteger(
      options.timeoutMs,
      '--timeout-ms',
      1_000,
      600_000,
    );
  }
  if (options.maxInputChars !== undefined) {
    next.maxInputChars = parseInteger(
      options.maxInputChars,
      '--max-input-chars',
      2_000,
      200_000,
    );
  }

  // Custom OpenAI-format gateways have no sensible default endpoint.
  if (next.provider === 'openai-compatible' && !next.baseUrl.trim()) {
    throw new KMindError('provider=openai-compatible 需要 --base-url', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: true,
      suggestion:
        '例如 --base-url https://<gateway>/v1（或完整 …/chat/completions）',
    });
  }

  await ctx.vault.saveConfig({ ...config, llm: next });
  return {
    status: describeLlmConfig({ ...config, llm: next }),
    path: ctx.vault.configPath,
  };
}

/** Parse and validate a `--provider` value. */
export function parseProvider(raw: string): LlmConfig['provider'] {
  const parsed = LlmProviderEnum.safeParse(raw.trim());
  if (!parsed.success) {
    throw new KMindError(`不支持的 provider：${raw}`, {
      category: 'CONFIG_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: `可选：${PROVIDER_CHOICES}`,
    });
  }
  return parsed.data;
}

/**
 * Validate a custom endpoint URL and drop trailing slashes.
 * Empty input clears the configured base URL.
 */
export function normalizeBaseUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new KMindError(`--base-url 不是合法 URL：${value}`, {
      category: 'CONFIG_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: '例如 https://api.example.com/v1 或 http://127.0.0.1:8000/v1',
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new KMindError(`--base-url 只支持 http/https：${value}`, {
      category: 'CONFIG_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: '例如 https://api.example.com/v1',
    });
  }
  return value.replace(/\/+$/, '');
}

export function parseBoolean(raw: string, flag: string): boolean {
  const value = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  throw new KMindError(`${flag} 须为 true 或 false`, {
    category: 'CONFIG_ERROR',
    severity: 'medium',
    retryable: true,
    suggestion: `当前值：${raw}`,
  });
}

function parseNumber(
  raw: string,
  flag: string,
  min: number,
  max: number,
): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new KMindError(`${flag} 须在 ${min}–${max} 之间`, {
      category: 'CONFIG_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: `当前值：${raw}`,
    });
  }
  return value;
}

function parseInteger(
  raw: string,
  flag: string,
  min: number,
  max: number,
): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new KMindError(`${flag} 须为 ${min}–${max} 的整数`, {
      category: 'CONFIG_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: `当前值：${raw}`,
    });
  }
  return value;
}
