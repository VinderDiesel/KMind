import type { BootstrapModule } from '@kmind/shared';

export interface ModuleGroupMeta {
  index: number;
  path: string;
  fileCount: number;
}

export interface LlmGroupResult {
  label: string;
  moduleIndexes: number[];
}

/**
 * Optional local LLM for bootstrap grouping / plan notes (ADR-004 Phase 2).
 * Never writes knowledge bodies.
 */
export interface BootstrapLlmClient {
  groupModules(meta: ModuleGroupMeta[]): Promise<LlmGroupResult[] | null>;
  planGroup(paths: string[], churn: number): Promise<string | null>;
}

export interface OllamaBootstrapLlmOptions {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Ollama-compatible client. Returns null on any failure → caller uses heuristics.
 */
export class OllamaBootstrapLlm implements BootstrapLlmClient {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaBootstrapLlmOptions = {}) {
    this.endpoint = (options.endpoint ?? 'http://127.0.0.1:11434').replace(
      /\/$/,
      '',
    );
    this.model = options.model?.trim() ?? '';
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async groupModules(meta: ModuleGroupMeta[]): Promise<LlmGroupResult[] | null> {
    if (!this.model || meta.length === 0) return null;
    if (!(await this.alive())) return null;
    const prompt = [
      'Group these code modules for knowledge dig tasks.',
      'Return ONLY JSON array: [{"label":"string","moduleIndexes":[0,1]}]',
      'Indexes refer to the numbered list. Cover every index exactly once.',
      ...meta.map(
        (m) => `${m.index}: ${m.path} (files≈${m.fileCount})`,
      ),
    ].join('\n');
    const text = await this.generate(prompt);
    if (!text) return null;
    return parseGroupJson(text, meta.length);
  }

  async planGroup(paths: string[], churn: number): Promise<string | null> {
    if (!this.model) return null;
    if (!(await this.alive())) return null;
    const prompt = [
      'In ≤80 words, list dig risks for these modules (no knowledge card body).',
      `churn≈${churn}`,
      paths.map((p) => `- ${p}`).join('\n'),
    ].join('\n');
    const text = await this.generate(prompt);
    return text?.trim() || null;
  }

  private async alive(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 2000)),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async generate(prompt: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { response?: string };
      return typeof body.response === 'string' ? body.response : null;
    } catch {
      return null;
    }
  }
}

/**
 * Apply LLM grouping over selected modules; null → caller keeps heuristic groups.
 */
export function modulesFromLlmGroups(
  selected: BootstrapModule[],
  groups: LlmGroupResult[],
): Map<string, BootstrapModule[]> | null {
  const used = new Set<number>();
  const byLabel = new Map<string, BootstrapModule[]>();
  for (const g of groups) {
    if (!g.label || !Array.isArray(g.moduleIndexes)) return null;
    const list: BootstrapModule[] = [];
    for (const idx of g.moduleIndexes) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= selected.length) return null;
      if (used.has(idx)) return null;
      used.add(idx);
      list.push(selected[idx]!);
    }
    if (list.length === 0) return null;
    byLabel.set(g.label, list);
  }
  if (used.size !== selected.length) return null;
  return byLabel;
}

function parseGroupJson(
  text: string,
  moduleCount: number,
): LlmGroupResult[] | null {
  try {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end < start) return null;
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(raw)) return null;
    const out: LlmGroupResult[] = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object') return null;
      const label = (row as { label?: unknown }).label;
      const idxs = (row as { moduleIndexes?: unknown }).moduleIndexes;
      if (typeof label !== 'string' || !Array.isArray(idxs)) return null;
      const moduleIndexes = idxs.map((n) => Number(n));
      if (moduleIndexes.some((n) => !Number.isInteger(n) || n < 0 || n >= moduleCount)) {
        return null;
      }
      out.push({ label, moduleIndexes });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
