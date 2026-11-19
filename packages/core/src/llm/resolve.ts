import {
  KMindConfigSchema,
  KMindError,
  type KMindConfig,
  type LlmProvider,
} from '@kmind/shared';
import type { LlmOverrides, ResolvedLlmConfig } from './types.js';

const DEFAULT_API_KEY_ENV = 'KMIND_LLM_API_KEY';

const DEFAULT_BASE_URLS: Record<LlmProvider, string> = {
  ollama: 'http://127.0.0.1:11434',
  openai: 'https://api.openai.com/v1',
  'openai-compatible': '',
  anthropic: 'https://api.anthropic.com',
  'azure-openai': '',
};

/** Provider fallback env names, tried after the configured `apiKeyEnv`. */
const PROVIDER_KEY_ENVS: Record<LlmProvider, string[]> = {
  ollama: [],
  openai: ['KMIND_LLM_API_KEY', 'OPENAI_API_KEY'],
  'openai-compatible': ['KMIND_LLM_API_KEY', 'OPENAI_API_KEY'],
  anthropic: ['KMIND_LLM_API_KEY', 'ANTHROPIC_API_KEY'],
  'azure-openai': [
    'KMIND_LLM_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'OPENAI_API_KEY',
  ],
};

/**
 * Providers that can run without an API key: local Ollama and self-hosted
 * OpenAI-format gateways (vLLM / LM Studio / LiteLLM behind no auth).
 */
function apiKeyOptional(provider: LlmProvider): boolean {
  return provider === 'ollama' || provider === 'openai-compatible';
}

function baseUrlHint(provider: LlmProvider): string {
  switch (provider) {
    case 'azure-openai':
      return '运行 `kmind llm set --provider azure-openai --base-url https://<resource>.openai.azure.com --model <deployment>`';
    case 'openai-compatible':
      return '运行 `kmind llm set --provider openai-compatible --base-url https://<gateway>/v1 --model <model-id>`';
    default:
      return '运行 `kmind llm set --provider <p> --base-url <url> --model <model-id>`';
  }
}

export type EnvLike = Record<string, string | undefined>;

export interface LlmConfigStatus {
  configured: boolean;
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  apiKeyPresent: boolean;
  apiKeySourceEnv?: string;
  source: 'config' | 'legacy-bootstrap';
  jsonMode: boolean;
  azureDeployment?: string;
  /** Human-readable reason the config cannot be used, if any. */
  problem?: string;
}

/**
 * Resolve effective LLM settings from vault config + CLI overrides + env.
 * Throws CONFIG_ERROR when a required model / base URL / API key is missing.
 */
export function resolveLlmConfig(
  config: KMindConfig,
  overrides: LlmOverrides = {},
  env: EnvLike = process.env,
): ResolvedLlmConfig {
  const configured = config.llm ?? KMindConfigSchema.parse({
    version: config.version,
    vaultPath: config.vaultPath,
  }).llm;
  const legacy = config.bootstrap?.llm;
  const legacyModel = legacy?.model?.trim() ?? '';
  const useLegacy = !configured.model.trim() && Boolean(legacyModel);

  const provider = overrides.provider ?? (useLegacy ? 'ollama' : configured.provider);
  const model = (
    overrides.model ??
    (useLegacy ? legacyModel : configured.model)
  ).trim();
  if (!model) {
    throw new KMindError('LLM model 未配置', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: false,
      suggestion:
        '运行 `kmind llm set --provider openai --model gpt-4o-mini`（或用 --model 临时覆盖）',
    });
  }

  const rawBaseUrl = (
    overrides.baseUrl ??
    (useLegacy ? legacy?.endpoint : configured.baseUrl) ??
    ''
  ).trim();
  const baseUrl = stripTrailingSlash(rawBaseUrl) || DEFAULT_BASE_URLS[provider];
  if (!baseUrl) {
    throw new KMindError(
      provider === 'azure-openai'
        ? 'Azure OpenAI 需要 --base-url'
        : `provider=${provider} 需要自定义 --base-url`,
      {
        category: 'CONFIG_ERROR',
        severity: 'high',
        retryable: false,
        suggestion: baseUrlHint(provider),
      },
    );
  }

  const apiKeyEnv =
    overrides.apiKeyEnv?.trim() || configured.apiKeyEnv || DEFAULT_API_KEY_ENV;
  const { apiKey, sourceEnv } = findApiKey(provider, apiKeyEnv, env);
  if (!apiKeyOptional(provider) && !apiKey) {
    throw new KMindError(`缺少 ${provider} API Key`, {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: false,
      suggestion: `export ${apiKeyEnv}=<key>（或 --api-key-env 指定其它变量名）；密钥不会写入 config.yaml`,
    });
  }

  const azureDeployment = (
    overrides.azureDeployment ?? configured.azureDeployment
  ).trim();

  return {
    provider,
    model,
    baseUrl,
    apiKey,
    apiKeyEnv,
    ...(sourceEnv ? { apiKeySourceEnv: sourceEnv } : {}),
    azureApiVersion:
      overrides.azureApiVersion?.trim() ||
      configured.azureApiVersion ||
      '2024-10-21',
    azureDeployment: azureDeployment || (provider === 'azure-openai' ? model : ''),
    jsonMode: overrides.jsonMode ?? configured.jsonMode ?? true,
    temperature:
      overrides.temperature ?? configured.temperature ?? 0.2,
    maxTokens: overrides.maxTokens ?? configured.maxTokens ?? 2048,
    timeoutMs:
      overrides.timeoutMs ??
      (useLegacy && legacy?.timeoutMs ? legacy.timeoutMs : configured.timeoutMs) ??
      120_000,
    maxInputChars: overrides.maxInputChars ?? configured.maxInputChars ?? 24_000,
    source: useLegacy ? 'legacy-bootstrap' : 'config',
  };
}

/** Same as resolveLlmConfig but returns null instead of throwing (heuristic fallback). */
export function resolveLlmConfigOptional(
  config: KMindConfig,
  overrides: LlmOverrides = {},
  env: EnvLike = process.env,
): ResolvedLlmConfig | null {
  try {
    return resolveLlmConfig(config, overrides, env);
  } catch {
    return null;
  }
}

/**
 * Non-throwing status for `kmind llm status` (never prints the key itself).
 */
export function describeLlmConfig(
  config: KMindConfig,
  overrides: LlmOverrides = {},
  env: EnvLike = process.env,
): LlmConfigStatus {
  const configured = config.llm;
  const legacyModel = config.bootstrap?.llm?.model?.trim() ?? '';
  const useLegacy = !configured.model.trim() && Boolean(legacyModel);
  const provider = overrides.provider ?? (useLegacy ? 'ollama' : configured.provider);
  const model = (
    overrides.model ??
    (useLegacy ? legacyModel : configured.model)
  ).trim();
  const rawBaseUrl = (
    overrides.baseUrl ??
    (useLegacy ? config.bootstrap?.llm?.endpoint : configured.baseUrl) ??
    ''
  ).trim();
  const baseUrl = stripTrailingSlash(rawBaseUrl) || DEFAULT_BASE_URLS[provider];
  const apiKeyEnv =
    overrides.apiKeyEnv?.trim() || configured.apiKeyEnv || DEFAULT_API_KEY_ENV;
  const { apiKey, sourceEnv } = findApiKey(provider, apiKeyEnv, env);

  let problem: string | undefined;
  if (!model) problem = 'model 未配置';
  else if (!baseUrl) problem = `baseUrl 未配置（${provider} 必填）`;
  else if (!apiKeyOptional(provider) && !apiKey) {
    problem = `环境变量 ${apiKeyEnv} 未设置`;
  }

  return {
    configured: !problem,
    provider,
    model,
    baseUrl,
    apiKeyEnv,
    apiKeyPresent: Boolean(apiKey),
    ...(sourceEnv ? { apiKeySourceEnv: sourceEnv } : {}),
    source: useLegacy ? 'legacy-bootstrap' : 'config',
    jsonMode: overrides.jsonMode ?? configured.jsonMode ?? true,
    ...(provider === 'azure-openai'
      ? {
          azureDeployment:
            (overrides.azureDeployment ?? configured.azureDeployment).trim() ||
            model,
        }
      : {}),
    ...(problem ? { problem } : {}),
  };
}

function findApiKey(
  provider: LlmProvider,
  configuredEnv: string,
  env: EnvLike,
): { apiKey?: string; sourceEnv?: string } {
  const candidates = [
    configuredEnv,
    ...PROVIDER_KEY_ENVS[provider],
  ].filter((name, index, all) => name && all.indexOf(name) === index);
  for (const name of candidates) {
    const value = env[name]?.trim();
    if (value) return { apiKey: value, sourceEnv: name };
  }
  return {};
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
