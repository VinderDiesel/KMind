import type { LlmProvider } from '@kmind/shared';

type FetchLike = typeof fetch;

export interface LlmModelListParams {
  provider: LlmProvider;
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface LlmModelListResult {
  models: string[];
  /** Non-fatal reason the list is empty (shown by the interactive picker). */
  warning?: string;
}

/**
 * Resolve the model-list endpoint for a provider.
 * Returns null when the provider exposes no listing API (Azure OpenAI).
 */
export function modelsEndpointFor(
  provider: LlmProvider,
  baseUrl: string,
): string | null {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return null;
  switch (provider) {
    case 'ollama':
      return `${base}/api/tags`;
    case 'anthropic':
      return `${base.endsWith('/v1') ? base : `${base}/v1`}/models`;
    case 'azure-openai':
      return null;
    case 'openai':
    case 'openai-compatible':
    default: {
      const root = base.endsWith('/chat/completions')
        ? base.slice(0, -'/chat/completions'.length)
        : base;
      return `${root}/models`;
    }
  }
}

/**
 * Extract model ids from a provider listing response.
 * `ollama` uses `models[].name`; OpenAI / Anthropic use `data[].id`.
 */
export function extractModelIds(
  provider: LlmProvider,
  body: unknown,
): string[] {
  if (!body || typeof body !== 'object') return [];
  const obj = body as Record<string, unknown>;
  const rows = Array.isArray(obj.data)
    ? obj.data
    : provider === 'ollama' && Array.isArray(obj.models)
      ? obj.models
      : [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const value =
      provider === 'ollama'
        ? (row as { name?: unknown }).name
        : (row as { id?: unknown }).id;
    if (typeof value === 'string' && value.trim()) ids.add(value.trim());
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * Best-effort model listing used by `kmind llm model`.
 * Never throws: failures surface as `warning` so the picker can fall back to
 * free-text input.
 */
export async function listLlmModels(
  params: LlmModelListParams,
  fetchImpl: FetchLike = fetch,
): Promise<LlmModelListResult> {
  const endpoint = modelsEndpointFor(params.provider, params.baseUrl);
  if (!endpoint) {
    return {
      models: [],
      warning:
        'Azure OpenAI 不提供模型列表接口，请手动输入 deployment 名（默认可与 model 同名）',
    };
  }

  const timeoutMs = params.timeoutMs ?? 8_000;
  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: modelHeaders(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const detail = await safeText(response);
      return {
        models: [],
        warning: `获取模型列表失败（HTTP ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}）`,
      };
    }
    const models = extractModelIds(params.provider, await response.json());
    return models.length > 0
      ? { models }
      : { models: [], warning: `${endpoint} 未返回可用模型` };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { models: [], warning: `获取模型列表失败：${message}` };
  }
}

function modelHeaders(params: LlmModelListParams): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (params.provider === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (params.apiKey) headers['x-api-key'] = params.apiKey;
  } else if (params.provider === 'azure-openai') {
    if (params.apiKey) headers['api-key'] = params.apiKey;
  } else if (params.provider !== 'ollama' && params.apiKey) {
    headers.authorization = `Bearer ${params.apiKey}`;
  }
  return headers;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
