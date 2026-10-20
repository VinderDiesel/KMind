import type { KnowledgeAsset, KnowledgeType } from '@kmind/shared';
import {
  hasCodeCitation,
  isOverviewTitle,
} from '../compiler/capture-quality.js';

const MIN_CHARS_DETAIL = 350;
const MIN_CHARS_FEATURE = 550;
const FEATURE_LIKE: ReadonlySet<KnowledgeType> = new Set([
  'architecture_design',
  'tool_usage',
  'process_spec',
  'code_snippet',
  'best_practice',
]);
const ANCHOR_TYPES: ReadonlySet<KnowledgeType> = new Set([
  'architecture_design',
  'tool_usage',
  'process_spec',
  'code_snippet',
]);

export type CoverageIssueCode =
  | 'no_hub'
  | 'hub_no_children'
  | 'duplicate_overview'
  | 'shallow_child'
  | 'missing_anchors'
  | 'orphan_detail'
  | 'empty_outbound'
  | 'thin_topic';

export interface CoverageIssue {
  code: CoverageIssueCode;
  severity: 'high' | 'medium' | 'low';
  assetId?: string;
  message: string;
}

export interface CoverageCardBrief {
  id: string;
  title: string;
  type: KnowledgeType;
  chars: number;
}

export interface CoverageReport {
  project: string;
  topic?: string;
  /** True only when no high/medium issues — agent must not claim「已完整」otherwise. */
  complete: boolean;
  hubs: Array<{
    id: string;
    title: string;
    childCount: number;
    shallowCount: number;
  }>;
  duplicateOverviews: Array<{ title: string; ids: string[] }>;
  shallow: CoverageCardBrief[];
  missingAnchors: CoverageCardBrief[];
  orphans: CoverageCardBrief[];
  issues: CoverageIssue[];
  nextActions: string[];
  summary: string;
}

export interface CoverageOptions {
  project: string;
  /** Narrow to titles/bodies matching this topic (e.g. 问数). */
  topic?: string;
  /** Prefer this hub when scoring children. */
  hubId?: string;
}

/**
 * Assess whether a project/topic is “dug deep” vs catalog-only.
 * Search hits + thin overview ≠ complete.
 */
export function assessProjectCoverage(
  assets: KnowledgeAsset[],
  options: CoverageOptions,
): CoverageReport {
  const project = options.project.trim();
  const topic = options.topic?.trim();
  const inProject = assets.filter(
    (a) => a.project === project && a.status !== 'deprecated',
  );
  const scoped = topic
    ? inProject.filter((a) => matchesTopic(a, topic))
    : inProject;

  const issues: CoverageIssue[] = [];
  const hubs = scoped.filter((a) => isOverviewTitle(a.title));
  const details = scoped.filter((a) => !isOverviewTitle(a.title));

  const duplicateOverviews = findDuplicateOverviews(
    topic ? hubs : inProject.filter((a) => isOverviewTitle(a.title)),
  );
  for (const dup of duplicateOverviews) {
    issues.push({
      code: 'duplicate_overview',
      severity: 'medium',
      message: `同名总览多份「${dup.title}」：${dup.ids.join(', ')} — 合并并用 supersedes，勿再挂一层`,
    });
  }

  if (hubs.length === 0 && details.length === 0) {
    issues.push({
      code: 'no_hub',
      severity: 'high',
      message: topic
        ? `主题「${topic}」在 project=${project} 下无任何知识卡`
        : `project=${project} 下无知识卡`,
    });
  } else if (hubs.length === 0 && details.length > 0) {
    issues.push({
      code: 'no_hub',
      severity: 'medium',
      message: '有明细卡但无总览导航：请补薄总览并用 related 串联',
    });
  }

  const linkedFromHub = new Set<string>();
  const hubSummaries: CoverageReport['hubs'] = [];
  const preferredHub = options.hubId
    ? hubs.find((h) => h.id === options.hubId)
    : undefined;
  const hubsToScore = preferredHub ? [preferredHub] : hubs;

  for (const hub of hubsToScore) {
    const childIds = collectChildIds(hub);
    for (const id of childIds) linkedFromHub.add(id);
    const children = childIds
      .map((id) => inProject.find((a) => a.id === id) ?? assets.find((a) => a.id === id))
      .filter((a): a is KnowledgeAsset => Boolean(a));
    const shallowKids = children.filter((c) => isShallowDetail(c));
    hubSummaries.push({
      id: hub.id,
      title: hub.title,
      childCount: children.length,
      shallowCount: shallowKids.length,
    });
    if (childIds.length === 0) {
      issues.push({
        code: 'hub_no_children',
        severity: 'high',
        assetId: hub.id,
        message: `总览「${hub.title}」无 related 子卡 — 禁止空索引`,
      });
    } else if (shallowKids.length === children.length && children.length > 0) {
      issues.push({
        code: 'shallow_child',
        severity: 'high',
        assetId: hub.id,
        message: `总览「${hub.title}」下全部 ${children.length} 张子卡过浅 — 禁止仅刷新索引宣称系统已整理完`,
      });
    } else if (shallowKids.length > 0) {
      issues.push({
        code: 'shallow_child',
        severity: 'medium',
        assetId: hub.id,
        message: `总览「${hub.title}」下有 ${shallowKids.length}/${children.length} 张子卡过浅，需深挖后重写`,
      });
    }
  }

  // Also score hubs not preferred when listing duplicates already done.
  if (preferredHub) {
    for (const hub of hubs) {
      if (hub.id === preferredHub.id) continue;
      for (const id of collectChildIds(hub)) linkedFromHub.add(id);
    }
  } else {
    for (const hub of hubs) {
      for (const id of collectChildIds(hub)) linkedFromHub.add(id);
    }
  }

  const shallow: CoverageCardBrief[] = [];
  const missingAnchors: CoverageCardBrief[] = [];
  for (const d of details) {
    if (isShallowDetail(d)) {
      shallow.push(brief(d));
      if (!issues.some((i) => i.assetId === d.id && i.code === 'shallow_child')) {
        issues.push({
          code: 'shallow_child',
          severity: 'medium',
          assetId: d.id,
          message: `明细卡过浅（${d.body.trim().length} 字）：${d.title}`,
        });
      }
    }
    if (needsAnchor(d) && !hasCodeCitation(d.body, readAnchorsMeta(d))) {
      missingAnchors.push(brief(d));
      issues.push({
        code: 'missing_anchors',
        severity: 'medium',
        assetId: d.id,
        message: `架构/流程类缺代码锚点：${d.title} — 先 Codegraph/读码再写`,
      });
    }
    if (
      (!d.related || d.related.length === 0) &&
      (!d.links || d.links.length === 0) &&
      !linkedFromHub.has(d.id)
    ) {
      // orphan checked below
    }
  }

  const orphans: CoverageCardBrief[] = [];
  for (const d of details) {
    const hasOutbound =
      (d.related?.length ?? 0) > 0 ||
      (d.links?.some(
        (l) =>
          l.relation === 'part_of' ||
          l.relation === 'related_to' ||
          l.relation === 'derives_from',
      ) ??
        false);
    if (!linkedFromHub.has(d.id) && !hasOutbound) {
      orphans.push(brief(d));
      issues.push({
        code: 'orphan_detail',
        severity: 'low',
        assetId: d.id,
        message: `明细卡未挂入总览图：${d.title}`,
      });
    } else if (!hasOutbound && linkedFromHub.has(d.id)) {
      // Hub links in; outbound empty is ok for star topology — soft note only via empty_outbound on hub side
    } else if (!hasOutbound) {
      issues.push({
        code: 'empty_outbound',
        severity: 'low',
        assetId: d.id,
        message: `明细卡无 outbound related/links（仅被总览挂住亦可，建议 part_of→总览）：${d.title}`,
      });
    }
  }

  if (topic && hubs.length > 0 && details.length < 3) {
    issues.push({
      code: 'thin_topic',
      severity: 'high',
      message: `主题「${topic}」明细卡仅 ${details.length} 张（<3）— 目录级整理未完成，须继续盘点深挖`,
    });
  }

  const blocking = issues.filter(
    (i) => i.severity === 'high' || i.severity === 'medium',
  );
  const complete = blocking.length === 0 && scoped.length > 0;

  const nextActions = buildNextActions(issues, hubs, shallow, missingAnchors);
  const summary = complete
    ? `覆盖合格：project=${project}${topic ? ` topic=${topic}` : ''}，${hubs.length} 总览 / ${details.length} 明细，无高/中问题`
    : `覆盖未完成：${blocking.length} 个高/中问题（共 ${issues.length}）。禁止对外宣称「知识已完整」——请按 nextActions 深挖，勿只刷新总览。`;

  return {
    project,
    ...(topic ? { topic } : {}),
    complete,
    hubs: hubSummaries.length
      ? hubSummaries
      : hubs.map((h) => ({
          id: h.id,
          title: h.title,
          childCount: collectChildIds(h).length,
          shallowCount: 0,
        })),
    duplicateOverviews,
    shallow,
    missingAnchors,
    orphans,
    issues,
    nextActions,
    summary,
  };
}

/**
 * Gate for overview capture: reject when all/most related children are shallow.
 */
export function assessOverviewChildrenDepth(
  relatedIds: string[],
  resolve: (id: string) => KnowledgeAsset | null | undefined,
): { ok: boolean; reasons: string[]; shallowIds: string[] } {
  const reasons: string[] = [];
  const shallowIds: string[] = [];
  const found: KnowledgeAsset[] = [];
  for (const id of relatedIds) {
    const a = resolve(id);
    if (!a) {
      reasons.push(`related 指向不存在的 id：${id}`);
      continue;
    }
    found.push(a);
    if (!isOverviewTitle(a.title) && isShallowDetail(a)) {
      shallowIds.push(a.id);
    }
  }
  if (found.length === 0) {
    return { ok: reasons.length === 0, reasons, shallowIds };
  }
  if (shallowIds.length === found.length) {
    reasons.push(
      `总览 related 下全部 ${found.length} 张子卡过浅：禁止仅刷新索引/重挂 related 宣称系统已整理完；请先对子主题 Codegraph 深挖并重写明细卡`,
    );
  } else if (shallowIds.length > found.length / 2) {
    reasons.push(
      `总览 related 下过半数子卡过浅（${shallowIds.length}/${found.length}：${shallowIds.slice(0, 5).join(', ')}）：请先深挖浅卡再写/改总览`,
    );
  }
  return { ok: reasons.length === 0, reasons, shallowIds };
}

function collectChildIds(hub: KnowledgeAsset): string[] {
  const ids = new Set<string>(hub.related ?? []);
  for (const l of hub.links ?? []) {
    if (
      l.relation === 'related_to' ||
      l.relation === 'derives_from' ||
      l.relation === 'part_of'
    ) {
      ids.add(l.id);
    }
  }
  return [...ids];
}

function isShallowDetail(a: KnowledgeAsset): boolean {
  if (isOverviewTitle(a.title)) return false;
  const text = a.body.trim();
  const min = FEATURE_LIKE.has(a.type) ? MIN_CHARS_FEATURE : MIN_CHARS_DETAIL;
  if (text.length < min) return true;
  const hasImpl = /实现(方式|步骤)?|implementation|步骤|调用链/i.test(text);
  const hasCaution = /注意|红线|禁止|边界|失败|caveat|pitfall/i.test(text);
  if (FEATURE_LIKE.has(a.type) && (!hasImpl || !hasCaution)) return true;
  if (needsAnchor(a) && !hasCodeCitation(text, readAnchorsMeta(a))) return true;
  // TOC-like: many short bullets with almost no prose (not structured 实现/注意/红线 cards)
  const lines = text.split('\n').filter((l) => l.trim());
  const bullets = lines.filter((l) => /^\s*[-*]\s+\S/.test(l));
  const proseLines = lines.filter(
    (l) =>
      !/^\s*[-*#]/.test(l) &&
      !/^\s*\d+[.)、]/.test(l) &&
      l.trim().length > 20,
  );
  if (bullets.length >= 10 && proseLines.length < 2 && text.length < min * 1.2) {
    return true;
  }
  return false;
}

function needsAnchor(a: KnowledgeAsset): boolean {
  return ANCHOR_TYPES.has(a.type);
}

function readAnchorsMeta(
  a: KnowledgeAsset,
): Array<{ file?: string; symbol?: string }> {
  const raw = a.metadata?.codeAnchors;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = item as { file?: string; symbol?: string };
    return { file: o.file, symbol: o.symbol };
  });
}

function matchesTopic(a: KnowledgeAsset, topic: string): boolean {
  const t = topic.toLowerCase();
  return (
    a.title.toLowerCase().includes(t) ||
    a.body.toLowerCase().includes(t) ||
    a.tags.some((tag) => tag.toLowerCase().includes(t))
  );
}

function normalizeOverviewTitle(title: string): string {
  return title
    .replace(/\s+/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .toLowerCase();
}

function findDuplicateOverviews(
  hubs: KnowledgeAsset[],
): Array<{ title: string; ids: string[] }> {
  const groups = new Map<string, KnowledgeAsset[]>();
  for (const h of hubs) {
    const key = normalizeOverviewTitle(h.title);
    const list = groups.get(key) ?? [];
    list.push(h);
    groups.set(key, list);
  }
  const out: Array<{ title: string; ids: string[] }> = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    out.push({
      title: list[0]!.title,
      ids: list.map((a) => a.id),
    });
  }
  return out;
}

function brief(a: KnowledgeAsset): CoverageCardBrief {
  return {
    id: a.id,
    title: a.title,
    type: a.type,
    chars: a.body.trim().length,
  };
}

function buildNextActions(
  issues: CoverageIssue[],
  hubs: KnowledgeAsset[],
  shallow: CoverageCardBrief[],
  missingAnchors: CoverageCardBrief[],
): string[] {
  const actions: string[] = [];
  if (issues.some((i) => i.code === 'no_hub')) {
    actions.push('盘点模块清单 → 写明细卡 → 再建薄总览 related 串联');
  }
  if (issues.some((i) => i.code === 'duplicate_overview')) {
    actions.push('合并同名总览：保留一份，其余 supersedes，停止再挂新总览');
  }
  if (shallow.length > 0) {
    actions.push(
      `深挖并重写浅卡（最多先做 5 张）：${shallow
        .slice(0, 5)
        .map((s) => s.id)
        .join(', ')} — Codegraph → 实现+注意+红线+锚点`,
    );
  }
  if (missingAnchors.length > 0) {
    actions.push(
      `补代码锚点：${missingAnchors
        .slice(0, 5)
        .map((s) => s.id)
        .join(', ')}`,
    );
  }
  if (issues.some((i) => i.code === 'hub_no_children')) {
    actions.push('为空总览补 related 子卡，或先写子卡再回填总览');
  }
  if (issues.some((i) => i.code === 'thin_topic')) {
    actions.push('主题明细不足：继续四阶段盘点（模块/阶段/可观测/迁移/踩坑），禁止只改总览');
  }
  if (actions.length === 0 && hubs.length > 0) {
    actions.push('覆盖已合格：增量写入时仍须 search → 深挖 → capture → kmind_coverage 验收');
  }
  return actions;
}
