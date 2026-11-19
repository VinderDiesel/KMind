import type { LlmProvider } from '@kmind/shared';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Ask providers with native JSON mode to constrain output. */
  json?: boolean;
}

/**
 * Fully resolved LLM settings (provider + model + base URL + key presence).
 * API keys are read from env at resolve time and never persisted.
 */
export interface ResolvedLlmConfig {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey?: string;
  /** Configured env var name (may differ from the env that supplied the key). */
  apiKeyEnv: string;
  /** Env var that actually supplied the key, when present. */
  apiKeySourceEnv?: string;
  azureApiVersion: string;
  azureDeployment: string;
  /** Send `response_format: json_object` to OpenAI-format endpoints. */
  jsonMode: boolean;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxInputChars: number;
  source: 'config' | 'legacy-bootstrap';
}

export interface LlmOverrides {
  provider?: LlmProvider;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  azureApiVersion?: string;
  azureDeployment?: string;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxInputChars?: number;
}

/** Minimal chat client shared by bootstrap planning and knowledge build. */
export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly baseUrl: string;
  chat(messages: LlmMessage[], options?: LlmChatOptions): Promise<string>;
}
