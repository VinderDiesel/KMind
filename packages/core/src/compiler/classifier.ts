import type {
  DecisionTrajectory,
  KnowledgeType,
  SessionRecord,
} from '@kmind/shared';

export interface RawCandidate {
  title: string;
  content: string;
  session?: SessionRecord;
  rawPath: string;
  /** When set (manual capture), classifier must honor this type. */
  typeHint?: KnowledgeType;
  projectHint?: string;
  contextHint?: Partial<DecisionTrajectory>;
}

export interface ClassificationResult {
  type: KnowledgeType;
  confidence: number;
  context: DecisionTrajectory;
  tags: string[];
}

export interface Classifier {
  classify(candidate: RawCandidate): Promise<ClassificationResult>;
}

const RULES: Array<{ type: KnowledgeType; patterns: RegExp[]; tags: string[] }> = [
  {
    type: 'architecture_design',
    patterns: [/architect/i, /event[- ]driven/i, /microservice/i, /设计架构/],
    tags: ['architecture'],
  },
  {
    type: 'pitfall',
    patterns: [/pitfall/i, /踩坑/i, /gotcha/i, /bug\b/i, /regression/i],
    tags: ['pitfall'],
  },
  {
    type: 'code_snippet',
    patterns: [/```/, /snippet/i, /code sample/i, /代码片段/],
    tags: ['code'],
  },
  {
    type: 'tool_usage',
    patterns: [/how to (use|run|install)/i, /cli\b/i, /工具使用/],
    tags: ['tool'],
  },
  {
    type: 'process_spec',
    patterns: [/process/i, /workflow/i, /checklist/i, /流程规范/],
    tags: ['process'],
  },
  {
    type: 'problem_solution',
    patterns: [/fix(ed)?\b/i, /solution/i, /resolve/i, /问题/],
    tags: ['solution'],
  },
  {
    type: 'best_practice',
    patterns: [/best practice/i, /recommend/i, /最佳实践/],
    tags: ['practice'],
  },
];

const TYPE_TAGS: Record<KnowledgeType, string[]> = {
  architecture_design: ['architecture'],
  pitfall: ['pitfall'],
  code_snippet: ['code'],
  tool_usage: ['tool'],
  process_spec: ['process'],
  problem_solution: ['solution'],
  best_practice: ['practice'],
};

/**
 * Local heuristic classifier (default). No network required.
 */
export class HeuristicClassifier implements Classifier {
  async classify(candidate: RawCandidate): Promise<ClassificationResult> {
    const text = `${candidate.title}\n${candidate.content}`;
    const context = buildContext(candidate, text);

    if (candidate.typeHint) {
      return {
        type: candidate.typeHint,
        confidence: 0.95,
        context,
        tags: TYPE_TAGS[candidate.typeHint] ?? ['manual'],
      };
    }

    let best: { type: KnowledgeType; score: number; tags: string[] } = {
      type: 'best_practice',
      score: 0.5,
      tags: ['general'],
    };

    for (const rule of RULES) {
      let hits = 0;
      for (const p of rule.patterns) {
        if (p.test(text)) hits += 1;
      }
      if (hits > 0) {
        const score = Math.min(0.5 + hits * 0.15, 0.95);
        if (score > best.score) {
          best = { type: rule.type, score, tags: rule.tags };
        }
      }
    }

    return {
      type: best.type,
      confidence: best.score,
      context,
      tags: best.tags,
    };
  }
}

/**
 * Optional Ollama classifier stub — falls back to heuristic when unavailable.
 */
export class OllamaClassifier implements Classifier {
  constructor(
    private readonly fallback: Classifier = new HeuristicClassifier(),
    private readonly endpoint = 'http://127.0.0.1:11434',
  ) {}

  async classify(candidate: RawCandidate): Promise<ClassificationResult> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(500),
      });
      if (!res.ok) return this.fallback.classify(candidate);
      return this.fallback.classify(candidate);
    } catch {
      return this.fallback.classify(candidate);
    }
  }
}

function buildContext(
  candidate: RawCandidate,
  text: string,
): DecisionTrajectory {
  const hint = candidate.contextHint ?? {};
  return {
    problem:
      hint.problem?.trim() ||
      extractSection(text, /problem|问题|背景/i) ||
      candidate.title,
    alternatives: hint.alternatives ?? [],
    decision:
      hint.decision?.trim() ||
      extractSection(text, /decision|决策|方案/i) ||
      truncate(candidate.content, 400),
    rationale:
      hint.rationale?.trim() ||
      extractSection(text, /rationale|原因|why/i) ||
      'Captured from explicit manual input',
    tradeOffs: hint.tradeOffs ?? [],
    outcome: hint.outcome,
  };
}

function extractSection(text: string, heading: RegExp): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (heading.test(lines[i] ?? '')) {
      return (lines[i + 1] ?? '').trim();
    }
  }
  return '';
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
