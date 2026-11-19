import path from 'node:path';
import {
  GeneratedKnowledgeCardRepairSchema,
  GeneratedKnowledgeCardSchema,
  type CodeAnchor,
  type GeneratedKnowledgeCard,
} from '@kmind/shared';
import { isOverviewTitle } from '../compiler/capture-quality.js';

export interface ParseGeneratedCardsResult {
  cards: GeneratedKnowledgeCard[];
  errors: string[];
}

/**
 * Parse and validate LLM card output. Anchors are constrained to evidence files.
 */
export function parseGeneratedCards(
  raw: string,
  allowedFiles: string[] = [],
): ParseGeneratedCardsResult {
  const errors: string[] = [];
  const parsed = extractJson(raw);
  if (parsed === null) {
    return { cards: [], errors: ['LLM 输出中没有可解析的 JSON'] };
  }

  let rows: unknown[];
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.cards)) rows = obj.cards;
    else if (obj.card && typeof obj.card === 'object') rows = [obj.card];
    else if ('title' in obj && 'content' in obj) rows = [obj];
    else rows = [];
  } else {
    rows = [];
  }
  if (rows.length === 0) {
    errors.push('JSON 中缺少 cards 数组');
    return { cards: [], errors };
  }

  const allowed = normalizeAllowedFiles(allowedFiles);
  const cards: GeneratedKnowledgeCard[] = [];
  const seenTitles = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const result = GeneratedKnowledgeCardSchema.safeParse(row);
    if (!result.success) {
      errors.push(
        `cards[${index}] 校验失败：${result.error.issues
          .map((issue) => `${issue.path.join('.') || 'root'} ${issue.message}`)
          .slice(0, 3)
          .join('; ')}`,
      );
      continue;
    }
    const card = normalizeCard(result.data, allowed);
    if (isOverviewTitle(card.title)) {
      errors.push(`cards[${index}] 标题像总览，已丢弃：${card.title}`);
      continue;
    }
    const key = card.title.trim().toLowerCase();
    if (seenTitles.has(key)) {
      errors.push(`cards[${index}] 标题重复，已丢弃：${card.title}`);
      continue;
    }
    seenTitles.add(key);
    cards.push(card);
  }

  return { cards, errors };
}

/**
 * Parse a single-card repair response.
 */
export function parseRepairedCard(
  raw: string,
  allowedFiles: string[] = [],
): GeneratedKnowledgeCard | null {
  const parsed = extractJson(raw);
  if (parsed === null) return null;
  const candidate =
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as { card?: unknown }).card
      ? (parsed as { card: unknown }).card
      : Array.isArray(parsed)
        ? parsed[0]
        : parsed;
  const result = GeneratedKnowledgeCardRepairSchema.safeParse({ card: candidate });
  if (!result.success) return null;
  const card = normalizeCard(
    result.data.card,
    normalizeAllowedFiles(allowedFiles),
  );
  return isOverviewTitle(card.title) ? null : card;
}

function normalizeCard(
  card: GeneratedKnowledgeCard,
  allowed: Set<string>,
): GeneratedKnowledgeCard {
  let anchors = card.anchors
    .map((anchor) => {
      const file = matchAllowedFile(anchor.file, allowed);
      return file ? { ...anchor, file, confidence: anchor.confidence ?? 1 } : null;
    })
    .filter((anchor): anchor is CodeAnchor => anchor !== null);
  if (anchors.length === 0 && allowed.size > 0) {
    anchors = deriveAnchorsFromContent(card.content, allowed);
  }
  return {
    ...card,
    title: card.title.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim(),
    content: card.content.trim(),
    anchors: dedupeAnchors(anchors).slice(0, 12),
    confidence: clamp(card.confidence ?? 0.6, 0, 1),
  };
}

function normalizeAllowedFiles(files: string[]): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    const norm = normalizePath(file);
    if (norm) out.add(norm);
  }
  return out;
}

function matchAllowedFile(
  file: string,
  allowed: Set<string>,
): string | null {
  if (allowed.size === 0) return normalizePath(file) || null;
  const norm = normalizePath(file);
  if (!norm) return null;
  if (allowed.has(norm)) return norm;
  const base = path.posix.basename(norm);
  for (const candidate of allowed) {
    if (path.posix.basename(candidate) === base) return candidate;
  }
  for (const candidate of allowed) {
    if (candidate.endsWith(`/${norm}`) || norm.endsWith(`/${candidate}`)) {
      return candidate;
    }
  }
  return null;
}

function deriveAnchorsFromContent(
  content: string,
  allowed: Set<string>,
): CodeAnchor[] {
  const out: CodeAnchor[] = [];
  for (const file of allowed) {
    const base = path.posix.basename(file);
    if (content.includes(file) || content.includes(base)) {
      out.push({ file, confidence: 1 });
    }
  }
  if (out.length > 0) return out;

  const section = content.split(/^##\s+代码锚点\s*$/m)[1] ?? '';
  for (const line of section.split('\n')) {
    const match = line.match(/-?\s*`?([\w./-]+\.(?:ts|tsx|js|jsx|py|go|java|rs|kt|sql|md))`?/);
    const file = match?.[1] ? matchAllowedFile(match[1], allowed) : null;
    if (file) out.push({ file, confidence: 1 });
  }
  return out;
}

function dedupeAnchors(anchors: CodeAnchor[]): CodeAnchor[] {
  const seen = new Set<string>();
  const out: CodeAnchor[] = [];
  for (const anchor of anchors) {
    const key = `${anchor.file}::${anchor.symbol ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(anchor);
  }
  return out;
}

function extractJson(raw: string): unknown | null {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1]) text = fence[1].trim();

  const candidates: string[] = [];
  const firstObj = text.indexOf('{');
  const lastObj = text.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) {
    candidates.push(text.slice(firstObj, lastObj + 1));
  }
  const firstArr = text.indexOf('[');
  const lastArr = text.lastIndexOf(']');
  if (firstArr >= 0 && lastArr > firstArr) {
    candidates.push(text.slice(firstArr, lastArr + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      /* try next */
    }
  }
  return null;
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
