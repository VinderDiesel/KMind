import { KMindError, type LlmProvider } from '@kmind/shared';
import type {
  LlmChatOptions,
  LlmClient,
  LlmMessage,
  ResolvedLlmConfig,
} from './types.js';

type FetchLike = typeof fetch;

/**
 * Create a chat client for the resolved provider.
 * Supports Ollama, OpenAI-compatible, Anthropic, and Azure OpenAI.
 */
export function createLlmClient(
  config: ResolvedLlmConfig,
  fetchImpl: FetchLike = fetch,
): LlmClient {
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    chat: async (messages, options = {}) =>
      chatOnce(config, messages, options, fetchImpl),
  };
}

async function chatOnce(
  config: ResolvedLlmConfig,
  messages: LlmMessage[],
  options: LlmChatOptions,
  fetchImpl: FetchLike,
): Promise<string> {
  const url = endpointFor(config);
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: headersFor(config),
      body: JSON.stringify(bodyFor(config, messages, options)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const timedOut =
      cause instanceof Error &&
      (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    throw new KMindError(
      timedOut
        ? `LLM 请求超时（${timeoutMs}ms）`
        : `LLM 请求失败：${cause instanceof Error ? cause.message : String(cause)}`,
      {
        category: 'ADAPTER_ERROR',
        severity: 'high',
        retryable: true,
        suggestion: `检查 provider=${config.provider} baseUrl=${config.baseUrl} 与网络/代理`,
        cause,
      },
    );
  }

  if (!response.ok) {
    const detail = await safeText(response);
    const retryable = response.status === 429 || response.status >= 500;
    throw new KMindError(
      `LLM HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      {
        category: 'ADAPTER_ERROR',
        severity: 'high',
        retryable,
        suggestion: httpErrorSuggestion(config, response.status),
      },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new KMindError('LLM 返回非 JSON 响应', {
      category: 'ADAPTER_ERROR',
      severity: 'high',
      retryable: true,
      suggestion: '确认 baseUrl 指向兼容的 chat completions 接口',
      cause,
    });
  }

  const text = extractText(config.provider, body);
  if (!text.trim()) {
    throw new KMindError('LLM 返回空内容', {
      category: 'ADAPTER_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: '降低 maxTokens 限制或换用支持 JSON 输出的模型',
    });
  }
  return text.trim();
}

function endpointFor(config: ResolvedLlmConfig): string {
  const base = config.baseUrl.replace(/\/+$/, '');
  switch (config.provider) {
    case 'ollama':
      return `${base}/api/chat`;
    case 'anthropic':
      return base.endsWith('/v1')
        ? `${base}/messages`
        : `${base}/v1/messages`;
    case 'azure-openai': {
      const deployment = encodeURIComponent(
        config.azureDeployment || config.model,
      );
      const version = encodeURIComponent(config.azureApiVersion);
      return `${base}/openai/deployments/${deployment}/chat/completions?api-version=${version}`;
    }
    case 'openai':
    case 'openai-compatible':
    default:
      // Accept both a base (`…/v1`) and a full `…/chat/completions` URL.
      return base.endsWith('/chat/completions')
        ? base
        : `${base}/chat/completions`;
  }
}

function headersFor(config: ResolvedLlmConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (config.provider === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (config.apiKey) headers['x-api-key'] = config.apiKey;
  } else if (config.provider === 'azure-openai') {
    if (config.apiKey) headers['api-key'] = config.apiKey;
  } else if (config.provider !== 'ollama' && config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

function bodyFor(
  config: ResolvedLlmConfig,
  messages: LlmMessage[],
  options: LlmChatOptions,
): Record<string, unknown> {
  const temperature = options.temperature ?? config.temperature;
  const maxTokens = options.maxTokens ?? config.maxTokens;

  if (config.provider === 'anthropic') {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    return {
      model: config.model,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    };
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  if (options.json) {
    if (config.provider === 'ollama') body.format = 'json';
    else if (config.jsonMode) body.response_format = { type: 'json_object' };
  }
  return body;
}

function httpErrorSuggestion(
  config: ResolvedLlmConfig,
  status: number,
): string {
  if (status === 401 || status === 403) {
    return `检查 ${config.apiKeyEnv}（或 provider 默认环境变量）是否有效`;
  }
  if (status === 400 || status === 404 || status === 422) {
    return (
      `检查 baseUrl（OpenAI 格式应为 <base>/v1 或完整 …/chat/completions）与 model；` +
      '若网关不支持 response_format=json_object，运行 `kmind llm set --json-mode false`'
    );
  }
  return '稍后重试；持续失败时检查 baseUrl / model / 配额';
}

function extractText(provider: LlmProvider, body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const obj = body as Record<string, unknown>;

  if (provider === 'anthropic') {
    const content = obj.content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (part && typeof part === 'object') {
            const text = (part as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }
          return '';
        })
        .join('');
    }
    return '';
  }

  if (provider === 'ollama') {
    const message = obj.message as { content?: unknown } | undefined;
    if (typeof message?.content === 'string') return message.content;
    return typeof obj.response === 'string' ? obj.response : '';
  }

  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as {
    text?: unknown;
    message?: { content?: unknown };
  };
  const content = first?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object') {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('');
  }
  return typeof first?.text === 'string' ? first.text : '';
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
