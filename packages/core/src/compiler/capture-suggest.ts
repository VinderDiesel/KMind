import {
  CAPTURE_SUGGEST_VERSION,
  CaptureSuggestReportSchema,
  type AssetLink,
  type CaptureSuggestReport,
  type CaptureSuggestion,
  type CodeAnchor,
  type KnowledgeType,
} from '@kmind/shared';
import type { SqliteStore } from '../storage/sqlite-store.js';
import type { AssetTypeRegistry } from '../asset-types/registry.js';
import { HeuristicClassifier } from './classifier.js';
import {
  assessCaptureQuality,
  hasCodeCitation,
  isOverviewTitle,
} from './capture-quality.js';
import { fulltextSearch } from '../query/fulltext.js';

export interface CaptureSuggestInput {
  content: string;
  title: string;
  project: string;
  type?: KnowledgeType;
  related?: string[];
  links?: AssetLink[];
  anchors?: Array<{ file?: string; symbol?: string; kind?: string; line?: number }>;
}

export interface CaptureSuggestDeps {
  store: SqliteStore;
  assetTypes?: AssetTypeRegistry;
}

/**
 * Build deterministic capture suggestions (ADR-002). No LLM; no silent rewrite.
 */
export async function buildCaptureSuggestions(
  input: CaptureSuggestInput,
  deps: CaptureSuggestDeps,
): Promise<CaptureSuggestReport> {
  const title = input.title.trim();
  const project = input.project.trim();
  const content = input.content;
  const related = [...(input.related ?? [])];
  const links = [...(input.links ?? [])];
  const anchors = normalizeAnchors(input.anchors);

  const classifier = new HeuristicClassifier(deps.assetTypes);
  const classified = await classifier.classify({
    title,
    content,
    rawPath: 'manual/suggest',
    typeHint: input.type,
  });
  const type = input.type ?? classified.type;

  const suggestions: CaptureSuggestion[] = [];
  let seq = 1;
  const nextId = (kind: string) => `sug-${kind}-${seq++}`;

  // —— Duplicates ——
  const hits = await fulltextSearch(deps.store, {
    query: title.slice(0, 120) || content.slice(0, 80),
    project,
    limit: 8,
  });
  for (const h of hits.slice(0, 3)) {
    if (h.score < 0.35) continue;
    const sameTitle =
      normalizeTitle(h.asset.title) === normalizeTitle(title) ||
      h.asset.title.includes(title.slice(0, 16)) ||
      title.includes(h.asset.title.slice(0, 16));
    if (!sameTitle && h.score < 0.55) continue;
    suggestions.push({
      id: nextId('dup'),
      kind: 'duplicate',
      message: `疑似重复：${h.asset.id}「${h.asset.title}」(score=${h.score.toFixed(2)}) — 确认后可跳过新建或 supersedes`,
      confidence: Math.min(0.95, 0.5 + h.score * 0.4),
      apply: {
        skipCapture: sameTitle && h.score >= 0.6,
        preferExistingId: h.asset.id,
        related: related.includes(h.asset.id) ? undefined : [h.asset.id],
      },
    });
  }

  // —— Type ——
  if (!input.type && classified.confidence >= 0.65) {
    suggestions.push({
      id: nextId('type'),
      kind: 'type',
      message: `建议 type=${classified.type}（启发式 confidence=${classified.confidence.toFixed(2)}）`,
      confidence: classified.confidence,
      apply: { type: classified.type },
    });
  } else if (
    input.type &&
    classified.type !== input.type &&
    classified.confidence >= 0.8
  ) {
    suggestions.push({
      id: nextId('type'),
      kind: 'type',
      message: `传入 type=${input.type}，正文更像 ${classified.type}（${classified.confidence.toFixed(2)}）— 请确认`,
      confidence: classified.confidence * 0.9,
      apply: { type: classified.type },
    });
  }

  // —— Hub / related ——
  const peers = await deps.store.queryAssets({ project, limit: 200 });
  const hubs = peers.filter((a) => isOverviewTitle(a.title));
  if (peers.length > 0 && related.length === 0 && !isOverviewTitle(title)) {
    const hubIds = hubs.slice(0, 3).map((h) => h.id);
    if (hubIds.length > 0) {
      suggestions.push({
        id: nextId('hub'),
        kind: 'related_hub',
        message: `增量库建议挂到总览：${hubs
          .slice(0, 3)
          .map((h) => `${h.id}「${h.title}」`)
          .join('、')}`,
        confidence: 0.85,
        apply: { related: hubIds },
      });
    } else {
      suggestions.push({
        id: nextId('hub'),
        kind: 'related_hub',
        message:
          '本 project 已有卡但无总览标题；建议 related 挂邻卡，或先建薄总览',
        confidence: 0.6,
        apply: {},
      });
    }
  }

  // —— Typed links ——
  if (
    type === 'problem_solution' &&
    !links.some((l) => l.relation === 'solves')
  ) {
    const problems = peers.filter((a) => a.type === 'problem').slice(0, 5);
    if (problems.length > 0) {
      const top = problems[0]!;
      suggestions.push({
        id: nextId('link'),
        kind: 'link',
        message: `problem_solution 建议 links.solves → ${top.id}「${top.title}」`,
        confidence: 0.75,
        apply: {
          links: [{ id: top.id, relation: 'solves' }],
        },
      });
    }
  }
  if (type === 'outcome' && !links.some((l) => l.relation === 'verifies')) {
    const problems = peers.filter((a) => a.type === 'problem').slice(0, 5);
    if (problems.length > 0) {
      const top = problems[0]!;
      suggestions.push({
        id: nextId('link'),
        kind: 'link',
        message: `outcome 必须 verifies；候选 ${top.id}「${top.title}」`,
        confidence: 0.88,
        apply: {
          links: [{ id: top.id, relation: 'verifies' }],
        },
      });
    }
  }

  // —— Anchors ——
  const needsAnchors =
    type === 'architecture_design' ||
    type === 'tool_usage' ||
    type === 'code_snippet' ||
    type === 'process_spec' ||
    deps.assetTypes
      ?.get(type)
      ?.rules.some((r) => 'requireCodeCitation' in r && r.requireCodeCitation);
  if (needsAnchors && !hasCodeCitation(content, anchors)) {
    suggestions.push({
      id: nextId('anchors'),
      kind: 'anchors',
      message:
        '架构/流程/工具类缺代码锚点 — 先 Codegraph/读码，再传 anchors 或写 ## 代码锚点',
      confidence: 0.9,
      apply: {},
    });
  }

  // —— Quality preview ——
  const typeDef = deps.assetTypes?.get(type);
  const quality = assessCaptureQuality(content, type, {
    title,
    related: mergeIds(related, flattenRelated(suggestions)),
    links: mergeLinks(links, flattenLinks(suggestions)),
    anchors,
    incremental: peers.length > 0,
    hubIds: hubs.map((h) => h.id),
    typeDef,
  });
  if (!quality.ok) {
    for (const reason of quality.reasons.slice(0, 5)) {
      suggestions.push({
        id: nextId('quality'),
        kind: 'quality',
        message: reason,
        confidence: 0.95,
        apply: {},
      });
    }
  }

  const proposed = buildProposed(type, related, links, anchors, suggestions);
  const hints = [
    '向人展示 suggestions；确认后把 apply 字段合并进 kmind_capture（回灌即确认）',
    ...quality.hints.slice(0, 3),
  ];

  return CaptureSuggestReportSchema.parse({
    version: CAPTURE_SUGGEST_VERSION,
    title,
    project,
    type: proposed.type,
    suggestions,
    proposedCapture: proposed,
    hints,
  });
}

function normalizeTitle(t: string): string {
  return t.replace(/\s+/g, '').toLowerCase();
}

function normalizeAnchors(
  anchors: CaptureSuggestInput['anchors'],
): CodeAnchor[] {
  if (!anchors) return [];
  const out: CodeAnchor[] = [];
  for (const a of anchors) {
    if (!a.file?.trim()) continue;
    out.push({
      file: a.file.trim(),
      symbol: a.symbol,
      kind: a.kind,
      line: a.line,
      confidence: 1,
    });
  }
  return out;
}

function flattenRelated(suggestions: CaptureSuggestion[]): string[] {
  return suggestions.flatMap((s) => s.apply.related ?? []);
}

function flattenLinks(suggestions: CaptureSuggestion[]): AssetLink[] {
  return suggestions.flatMap((s) => s.apply.links ?? []);
}

function mergeIds(base: string[], extra: string[]): string[] {
  return [...new Set([...base, ...extra])];
}

function mergeLinks(base: AssetLink[], extra: AssetLink[]): AssetLink[] {
  const key = (l: AssetLink) => `${l.relation}:${l.id}`;
  const map = new Map(base.map((l) => [key(l), l]));
  for (const l of extra) map.set(key(l), l);
  return [...map.values()];
}

function buildProposed(
  type: KnowledgeType,
  related: string[],
  links: AssetLink[],
  anchors: CodeAnchor[],
  suggestions: CaptureSuggestion[],
): {
  type: KnowledgeType;
  related: string[];
  links: AssetLink[];
  anchors: CodeAnchor[];
} {
  let nextType = type;
  let nextRelated = [...related];
  let nextLinks = [...links];
  const nextAnchors = [...anchors];

  for (const s of suggestions) {
    if (s.kind === 'duplicate' && s.apply.skipCapture) continue;
    if (s.confidence < 0.7) continue;
    if (s.apply.type) nextType = s.apply.type;
    if (s.apply.related) {
      nextRelated = mergeIds(nextRelated, s.apply.related);
    }
    if (s.apply.links) {
      nextLinks = mergeLinks(nextLinks, s.apply.links);
    }
    if (s.apply.anchors) {
      for (const a of s.apply.anchors) {
        if (!nextAnchors.some((x) => x.file === a.file && x.symbol === a.symbol)) {
          nextAnchors.push(a);
        }
      }
    }
  }

  return {
    type: nextType,
    related: nextRelated,
    links: nextLinks,
    anchors: nextAnchors,
  };
}
