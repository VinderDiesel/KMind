import { z } from 'zod';
import {
  CodeAnchorSchema,
  KnowledgeTypeIdSchema,
} from './knowledge-asset.schema.js';

/**
 * Supported LLM providers (ADR-005).
 * `openai` is the hosted OpenAI API (default baseUrl api.openai.com);
 * `openai-compatible` is any custom OpenAI-format gateway (DeepSeek / Qwen /
 * vLLM / LiteLLM / OneAPI / LM Studio …) and requires an explicit baseUrl.
 */
export const LlmProviderEnum = z.enum([
  'ollama',
  'openai',
  'openai-compatible',
  'anthropic',
  'azure-openai',
]);
export type LlmProvider = z.infer<typeof LlmProviderEnum>;

/**
 * LLM settings stored in vault `config.yaml` (top-level `llm`).
 * API keys are never persisted — only the env var name is stored.
 */
export const LlmConfigSchema = z.object({
  provider: LlmProviderEnum.default('ollama'),
  /** Empty model disables LLM features (bootstrap stays heuristic-only). */
  model: z.string().default(''),
  /**
   * Empty → provider default (Ollama/OpenAI/Anthropic); required for
   * `azure-openai` and `openai-compatible`. Accepts a base (`…/v1`) or a full
   * `…/chat/completions` URL.
   */
  baseUrl: z.string().default(''),
  /** Env var holding the API key; provider defaults are tried as fallback. */
  apiKeyEnv: z.string().default('KMIND_LLM_API_KEY'),
  azureApiVersion: z.string().default('2024-10-21'),
  /** Azure deployment name; empty → falls back to model. */
  azureDeployment: z.string().default(''),
  /**
   * Send `response_format: {type:'json_object'}` to OpenAI-format endpoints.
   * Turn off for gateways that reject the field.
   */
  jsonMode: z.boolean().default(true),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().min(1).max(32_768).default(2048),
  timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
  /** Evidence budget per module (files are truncated to fit). */
  maxInputChars: z.number().int().min(2000).max(200_000).default(24_000),
});
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

/**
 * One knowledge card proposed by the LLM during `bootstrap run --write`.
 * External model output → always Zod-validated before capture.
 */
export const GeneratedKnowledgeCardSchema = z.object({
  title: z.string().trim().min(4).max(120),
  type: KnowledgeTypeIdSchema,
  content: z.string().trim().min(120),
  anchors: z.array(CodeAnchorSchema).max(12).default([]),
  confidence: z.number().min(0).max(1).default(0.6),
  notes: z.string().max(1000).optional(),
});
export type GeneratedKnowledgeCard = z.infer<
  typeof GeneratedKnowledgeCardSchema
>;

/** LLM envelope: `{ "cards": [...] }`. */
export const GeneratedKnowledgeCardEnvelopeSchema = z.object({
  cards: z.array(GeneratedKnowledgeCardSchema).max(8),
});
export type GeneratedKnowledgeCardEnvelope = z.infer<
  typeof GeneratedKnowledgeCardEnvelopeSchema
>;

/** LLM repair response for a single card that failed the quality gate. */
export const GeneratedKnowledgeCardRepairSchema = z.object({
  card: GeneratedKnowledgeCardSchema,
});
export type GeneratedKnowledgeCardRepair = z.infer<
  typeof GeneratedKnowledgeCardRepairSchema
>;
