import type {
  KnowledgeAsset,
  KnowledgeType,
  Terminal,
} from './schemas/knowledge-asset.schema.js';
import type { SessionRecord } from './schemas/session.schema.js';

export interface KnowledgeAssetFactoryOptions {
  type?: KnowledgeType;
  id?: string;
  title?: string;
  project?: string;
  terminal?: Terminal;
  body?: string;
  tags?: string[];
}

let idCounter = 1;

/**
 * Create a valid KnowledgeAsset for tests.
 */
export function createKnowledgeAsset(
  options: KnowledgeAssetFactoryOptions = {},
): KnowledgeAsset {
  const type = options.type ?? 'best_practice';
  const seq = String(idCounter++).padStart(3, '0');
  const id = options.id ?? `k-2026-10-15-${seq}`;
  const now = '2026-10-15T12:00:00.000Z';
  const terminal = options.terminal ?? 'manual';

  return {
    id,
    type,
    title: options.title ?? `Test ${type}`,
    project: options.project ?? 'global',
    timestamp: now,
    status: 'draft',
    confidence: 0.8,
    expiresAt: null,
    source: {
      terminal,
      rawPath: `manual/${id}.md`,
      capturedAt: now,
    },
    context: {
      problem: 'test problem',
      alternatives: [],
      decision: 'test decision',
      rationale: 'test rationale',
      tradeOffs: [],
    },
    tags: options.tags ?? [type],
    related: [],
    body: options.body ?? `## Background\n\nTest body for ${type}.`,
    ontologyClass: typeToClass(type),
    metadata: {},
  };
}

/**
 * Create a SessionRecord for a given terminal.
 */
export function createSessionRecord(
  terminal: Terminal = 'claude-code',
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  const now = '2026-10-15T12:00:00.000Z';
  return {
    terminal,
    sessionId: overrides.sessionId ?? `sess-${terminal}-001`,
    startedAt: overrides.startedAt ?? now,
    endedAt: overrides.endedAt,
    project: overrides.project ?? 'global',
    messages: overrides.messages ?? [
      {
        role: 'user',
        content: 'How should we design the payment service?',
        timestamp: now,
      },
      {
        role: 'assistant',
        content: 'Consider event-driven architecture with a message queue.',
        timestamp: now,
      },
    ],
    metadata: overrides.metadata ?? {},
  };
}

/**
 * Reset factory id counter (for deterministic tests).
 */
export function resetFactoryCounters(): void {
  idCounter = 1;
}

function typeToClass(type: KnowledgeType): string {
  const map: Record<KnowledgeType, string> = {
    problem_solution: 'ProblemSolution',
    best_practice: 'BestPractice',
    architecture_design: 'ArchitectureDesign',
    tool_usage: 'ToolUsage',
    pitfall: 'Pitfall',
    code_snippet: 'CodeSnippet',
    process_spec: 'ProcessSpec',
  };
  return map[type];
}
