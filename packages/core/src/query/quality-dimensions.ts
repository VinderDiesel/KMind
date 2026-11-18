import type { KnowledgeAsset } from '@kmind/shared';
import {
  assessCaptureQuality,
  detectTopicDrift,
  isOverviewTitle,
} from '../compiler/capture-quality.js';
import type {
  CoverageIssue,
  CoverageMetrics,
  CoverageReport,
} from './coverage.js';

export interface QualityDimensionSlice {
  /** 0–100 deterministic score for Agents / humans. */
  score: number;
  issues: Array<{ code: string; message: string }>;
}

export interface KnowledgeQualityReport {
  coverage: QualityDimensionSlice & { metrics: CoverageMetrics };
  content: QualityDimensionSlice & {
    gatedFail: number;
    decisionNoise: number;
    topicDrift: number;
  };
  diversity: QualityDimensionSlice & {
    histogram: Record<string, number>;
  };
}

const DIVERSITY_FOCUS_CAP = 5;

/**
 * Build three-dimension knowledge quality scores from a coverage report + assets.
 * Does not change `complete` — scores are advisory except via coverage issues already raised.
 */
export function buildKnowledgeQualityReport(
  report: CoverageReport,
  assets: KnowledgeAsset[],
): KnowledgeQualityReport {
  const project = report.project;
  const scoped = assets.filter(
    (a) => a.project === project && a.status !== 'deprecated',
  );
  const details = scoped.filter((a) => !isOverviewTitle(a.title));
  const topic = report.topic?.trim().toLowerCase();
  const scopedDetails = topic
    ? details.filter(
        (a) =>
          a.title.toLowerCase().includes(topic) ||
          a.body.toLowerCase().includes(topic),
      )
    : details;

  const coverageIssues = report.issues.filter((i) =>
    isCoverageDimensionIssue(i.code),
  );
  const diversityIssues = report.issues.filter((i) =>
    isDiversityDimensionIssue(i.code),
  );

  let gatedFail = 0;
  let decisionNoise = 0;
  let topicDrift = 0;
  const contentIssues: Array<{ code: string; message: string }> = [];

  for (const a of scopedDetails) {
    const q = assessCaptureQuality(a.body, a.type, {
      title: a.title,
      related: a.related,
      links: a.links,
      anchors: readAnchors(a),
      incremental: false,
    });
    if (!q.ok) {
      gatedFail += 1;
      contentIssues.push({
        code: 'content_gate_fail',
        message: `${a.id}「${a.title}」: ${q.reasons[0] ?? 'quality gate'}`,
      });
    }
    if (detectTopicDrift(a.title, a.body)) {
      topicDrift += 1;
      contentIssues.push({
        code: 'topic_drift',
        message: `${a.id}「${a.title}」主题漂移（实现+协议同卡）`,
      });
    }
    if (isDecisionNoise(a)) {
      decisionNoise += 1;
      contentIssues.push({
        code: 'decision_noise',
        message: `${a.id}「${a.title}」context.decision 疑似抽取噪声`,
      });
    }
  }

  const coverageScore = scoreFromIssues(coverageIssues, {
    completeBonus: report.complete,
    hubBonus: report.metrics.hubCount > 0,
  });
  const contentScore = clampScore(
    100 -
      gatedFail * 25 -
      topicDrift * 15 -
      decisionNoise * 10 -
      Math.max(0, contentIssues.length - gatedFail - topicDrift - decisionNoise) *
        5,
  );
  const uniqueTypes = Object.keys(report.metrics.typeHistogram).length;
  const denom = Math.min(
    Math.max(report.metrics.detailCount, 1),
    DIVERSITY_FOCUS_CAP,
  );
  let diversityScore = Math.round((uniqueTypes / denom) * 100);
  if (diversityIssues.length > 0) {
    diversityScore = Math.min(diversityScore, 40);
  }
  if (report.metrics.detailCount === 0) {
    diversityScore = 0;
  }
  diversityScore = clampScore(diversityScore);

  return {
    coverage: {
      score: coverageScore,
      issues: coverageIssues.map(briefIssue),
      metrics: report.metrics,
    },
    content: {
      score: contentScore,
      issues: contentIssues.slice(0, 20),
      gatedFail,
      decisionNoise,
      topicDrift,
    },
    diversity: {
      score: diversityScore,
      issues: diversityIssues.map(briefIssue),
      histogram: report.metrics.typeHistogram,
    },
  };
}

function isCoverageDimensionIssue(code: string): boolean {
  return [
    'no_hub',
    'hub_no_children',
    'duplicate_overview',
    'shallow_child',
    'orphan_detail',
    'empty_outbound',
    'thin_topic',
    'broken_anchor_path',
    'broken_anchor_symbol',
    'missing_anchors',
    'expired_asset',
    'bootstrap_done_without_hub',
    'codegraph_required_unavailable',
  ].includes(code);
}

function isDiversityDimensionIssue(code: string): boolean {
  return code === 'type_mono' || code === 'type_homogeneous';
}

function briefIssue(i: CoverageIssue): { code: string; message: string } {
  return { code: i.code, message: i.message };
}

function scoreFromIssues(
  issues: CoverageIssue[],
  opts: { completeBonus: boolean; hubBonus: boolean },
): number {
  let score = opts.hubBonus ? 70 : 40;
  if (opts.completeBonus) score = 100;
  for (const i of issues) {
    if (i.severity === 'high') score -= 25;
    else if (i.severity === 'medium') score -= 15;
    else score -= 5;
  }
  return clampScore(score);
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function readAnchors(
  a: KnowledgeAsset,
): Array<{ file?: string; symbol?: string }> {
  const raw = a.metadata?.codeAnchors;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    const o = x as { file?: string; symbol?: string };
    return { file: o.file, symbol: o.symbol };
  });
}

function isDecisionNoise(a: KnowledgeAsset): boolean {
  const decision = a.context?.decision?.trim() ?? '';
  if (!decision) return false;
  if (decision.length < 80 && a.body.trim().length > 400) {
    if (/^\s*[-*]\s*\*\*禁止/.test(decision) || /宣称 complete/.test(decision)) {
      return true;
    }
  }
  // Decision should not be only a redline bullet when ## 实现方式 exists.
  if (
    /##\s*实现方式/.test(a.body) &&
    decision.length < 120 &&
    !/实现|步骤|export |packages\//.test(decision) &&
    /禁止|红线/.test(decision)
  ) {
    return true;
  }
  return false;
}
