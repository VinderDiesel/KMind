import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  BootstrapRulesFileSchema,
  type BootstrapRuleEntry,
  type KnowledgeType,
} from '@kmind/shared';
import { matchPathGlob } from './glob.js';

export interface TypeMatch {
  candidateType: KnowledgeType;
  titleHint: string;
  notes?: string;
  /** Rule overlay requested exclusion. */
  exclude?: boolean;
}

/**
 * Deterministic path → candidate knowledge type (ADR-004).
 * Overlay rules (first match) win over builtins.
 */
export function matchCandidateType(
  modulePath: string,
  overlay: BootstrapRuleEntry[] = [],
): TypeMatch {
  const p = modulePath.replace(/\\/g, '/');
  for (const rule of overlay) {
    if (!matchPathGlob(rule.pathGlob, p)) continue;
    if (rule.exclude) {
      return {
        candidateType: 'architecture_design',
        titleHint: path.basename(p),
        exclude: true,
        notes: rule.notes,
      };
    }
    if (rule.candidateType) {
      const base = p.split('/').filter(Boolean).pop() ?? p;
      return {
        candidateType: rule.candidateType,
        titleHint: rule.titleHint?.trim() || `${base} (${rule.candidateType})`,
        notes: rule.notes,
      };
    }
  }
  return builtinMatch(p);
}

/**
 * Load vault bootstrap-rules.yaml (or configured path). Missing file → [].
 */
export async function loadBootstrapRules(
  vaultRoot: string,
  rulesPath?: string,
): Promise<BootstrapRuleEntry[]> {
  const rel = rulesPath?.trim() || 'bootstrap-rules.yaml';
  const abs = path.isAbsolute(rel) ? rel : path.join(vaultRoot, rel);
  try {
    const raw = await fs.readFile(abs, 'utf8');
    const { parse } = await import('yaml');
    const doc = parse(raw) as unknown;
    const parsed = BootstrapRulesFileSchema.safeParse(doc);
    if (!parsed.success) return [];
    return parsed.data.rules;
  } catch {
    return [];
  }
}

function builtinMatch(modulePath: string): TypeMatch {
  const p = modulePath.toLowerCase();
  const base =
    modulePath.split('/').filter(Boolean).pop() ?? modulePath;

  if (
    /(^|\/)(commands|cli)(\/|$)/.test(p) ||
    /\/mcp-server(\/|$)/.test(p) ||
    /(^|\/)tools\.ts$/.test(p)
  ) {
    return {
      candidateType: 'tool_usage',
      titleHint: `${base} CLI/MCP surface`,
    };
  }

  if (/(^|\/)skills?(\/|$)/.test(p) || /skill\.md$/.test(p)) {
    return {
      candidateType: 'process_spec',
      titleHint: `${base} agent process`,
    };
  }

  if (/(^|\/)adapters?(\/|$)/.test(p)) {
    return {
      candidateType: 'architecture_design',
      titleHint: `${base} adapter boundary`,
    };
  }

  if (/(^|\/)(schedule|health|lifecycle|observability)(\/|$)/.test(p)) {
    return {
      candidateType: 'process_spec',
      titleHint: `${base} ops / maintenance`,
      notes: 'Prefer tool_usage if the dig finds concrete CLI commands only.',
    };
  }

  if (
    /(^|\/)(test|tests|__tests__|e2e)(\/|$)/.test(p) ||
    /\.test\.[jt]sx?$/.test(p)
  ) {
    return {
      candidateType: 'process_spec',
      titleHint: `${base} test conventions`,
      notes:
        'Skip unless team needs a reusable test checklist; do not invent pitfalls.',
    };
  }

  if (/(^|\/)docs(\/|$)/.test(p) || /\.md$/.test(p)) {
    return {
      candidateType: 'best_practice',
      titleHint: `${base} documented practice`,
      notes:
        'Only capture if it encodes a closed decision not already in vault.',
    };
  }

  return {
    candidateType: 'architecture_design',
    titleHint: `${base} module design`,
    notes:
      'Look for evidence of pitfalls during dig; do not invent pitfall cards.',
  };
}
