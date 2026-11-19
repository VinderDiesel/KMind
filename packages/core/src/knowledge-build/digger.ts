import type { DigTask, GeneratedKnowledgeCard } from '@kmind/shared';
import type { LlmClient } from '../llm/types.js';
import { parseGeneratedCards, parseRepairedCard } from './parse.js';
import {
  buildDigPrompt,
  buildRepairPrompt,
  type PromptTypeOption,
} from './prompts.js';
import type { ModuleEvidence } from './scanner.js';

export interface DigModuleInput {
  project: string;
  task: DigTask;
  evidence: ModuleEvidence;
  existingTitles: string[];
  maxCards: number;
  typeOptions: PromptTypeOption[];
}

export interface DigModuleResult {
  cards: GeneratedKnowledgeCard[];
  errors: string[];
  /** Raw model output (truncated) for diagnostics when parsing fails. */
  rawPreview?: string;
}

/**
 * One LLM dig call for a module + strict JSON validation.
 */
export async function digModuleWithLlm(
  llm: LlmClient,
  input: DigModuleInput,
): Promise<DigModuleResult> {
  const prompt = buildDigPrompt(input);
  const raw = await llm.chat(
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    { json: true },
  );
  const allowed = input.evidence.files.map((file) => file.path);
  const parsed = parseGeneratedCards(raw, allowed);
  return {
    cards: parsed.cards,
    errors: parsed.errors,
    ...(parsed.cards.length === 0 ? { rawPreview: raw.slice(0, 600) } : {}),
  };
}

export interface RepairCardInput {
  project: string;
  card: GeneratedKnowledgeCard;
  reasons: string[];
  evidence: ModuleEvidence;
  candidateType?: string;
}

/**
 * One repair attempt for a card that failed the quality gate.
 */
export async function repairCardWithLlm(
  llm: LlmClient,
  input: RepairCardInput,
): Promise<GeneratedKnowledgeCard | null> {
  const prompt = buildRepairPrompt({
    project: input.project,
    type: input.card.type,
    title: input.card.title,
    content: input.card.content,
    reasons: input.reasons,
    evidence: input.evidence,
    ...(input.candidateType ? { candidateType: input.candidateType } : {}),
  });
  const raw = await llm.chat(
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    { json: true },
  );
  return parseRepairedCard(
    raw,
    input.evidence.files.map((file) => file.path),
  );
}
