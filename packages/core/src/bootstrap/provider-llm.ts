import type { KMindConfig } from '@kmind/shared';
import { createLlmClient, resolveLlmConfigOptional } from '../llm/index.js';
import type { LlmClient, LlmOverrides } from '../llm/types.js';
import {
  parseGroupJson,
  type BootstrapLlmClient,
  type LlmGroupResult,
  type ModuleGroupMeta,
} from './llm.js';

/**
 * Adapts any configured LLM provider to the bootstrap planner contract.
 * Failures return null so planning falls back to heuristics.
 */
export class ProviderBootstrapLlm implements BootstrapLlmClient {
  constructor(private readonly client: LlmClient) {}

  async groupModules(meta: ModuleGroupMeta[]): Promise<LlmGroupResult[] | null> {
    if (meta.length === 0) return null;
    const prompt = [
      'Group these code modules for knowledge dig tasks.',
      'Return ONLY JSON array: [{"label":"string","moduleIndexes":[0,1]}]',
      'Indexes refer to the numbered list. Cover every index exactly once.',
      ...meta.map((m) => `${m.index}: ${m.path} (files≈${m.fileCount})`),
    ].join('\n');
    try {
      const text = await this.client.chat(
        [
          {
            role: 'system',
            content: 'You group code modules. Output JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        { json: true },
      );
      return parseGroupJson(text, meta.length);
    } catch {
      return null;
    }
  }

  async planGroup(paths: string[], churn: number): Promise<string | null> {
    const prompt = [
      'In ≤80 words, list dig risks for these modules (no knowledge card body).',
      `churn≈${churn}`,
      paths.map((p) => `- ${p}`).join('\n'),
    ].join('\n');
    try {
      const text = await this.client.chat([
        { role: 'user', content: prompt },
      ]);
      return text.trim() || null;
    } catch {
      return null;
    }
  }
}

/**
 * Build a bootstrap LLM from top-level `llm` config (or legacy `bootstrap.llm`).
 * Returns undefined when no usable model/key is configured.
 */
export function createBootstrapLlmFromConfig(
  config: KMindConfig,
  overrides: LlmOverrides = {},
): BootstrapLlmClient | undefined {
  const resolved = resolveLlmConfigOptional(config, overrides);
  if (!resolved) return undefined;
  return new ProviderBootstrapLlm(createLlmClient(resolved));
}
