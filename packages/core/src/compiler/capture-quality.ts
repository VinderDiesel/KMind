import type { AssetTypeDef, KnowledgeType } from '@kmind/shared';

export interface CaptureQualityOptions {
  title?: string;
  related?: string[];
  /** Typed links (solves / verifies / …). */
  links?: Array<{ id: string; relation: string }>;
  /** Explicit code anchors from capture args. */
  anchors?: Array<{ file?: string; symbol?: string }>;
  /**
   * Project already has knowledge (incremental write).
   * Non-overview cards must attach related/links into the existing graph.
   */
  incremental?: boolean;
  /** Suggested hub ids (e.g. 总览) for hints when incremental attach is missing. */
  hubIds?: string[];
  /** ADR-001: type def from AssetTypeRegistry (sections + whitelist rules). */
  typeDef?: AssetTypeDef;
}

export interface CaptureQualityResult {
  ok: boolean;
  reasons: string[];
  /** Soft hints even when ok — agents should still enrich. */
  hints: string[];
}

/** Types that describe how something works (need implementation depth). */
const FEATURE_LIKE: ReadonlySet<string> = new Set([
  'architecture_design',
  'tool_usage',
  'process_spec',
  'code_snippet',
  'best_practice',
]);

const PROBLEM_TYPE = 'problem';
const OUTCOME_TYPE = 'outcome';

/** Depth floor: incremental/default captures must clear this without user nagging. */
const MIN_CHARS_FEATURE = 550;
const MIN_CHARS_DEFAULT = 350;
const MIN_CHARS_OVERVIEW = 200;
/** Single-topic detail cards should stay focused; overviews must be thin. */
const MAX_CHARS_DETAIL = 3200;
const MAX_CHARS_OVERVIEW = 1800;
const MAX_TOPIC_H2_DETAIL = 3;
const MAX_TOPIC_H2_OVERVIEW = 2;
const MAX_COMPONENT_BLOBS = 3;

/** Allowed structural headings — do not count as extra “topics”. */
const STRUCTURAL_H2 =
  /^(实现方式|注意事项|红线规避|问题|决策|方案|取舍|结果|验证|适用边界|代码锚点|背景|权衡|implementation|cautions?|red\s*lines?|problem|decision|trade-?offs?|outcome|notes?)$/i;

/** Heading / keyword families that count as “明细” coverage. */
const DETAIL_FAMILIES: Array<{ id: string; patterns: RegExp[]; label: string }> =
  [
    {
      id: 'implementation',
      label: '实现方式（步骤/接口/配置/代码路径）',
      patterns: [
        /实现(方式|步骤|细节|路径)?/i,
        /how\s*to|implementation|steps?/i,
        /调用链|接口|配置|算法|伪代码|代码路径/,
        /##\s*(实现|步骤|做法|方案落地)/,
      ],
    },
    {
      id: 'cautions',
      label: '注意事项（边界/前置条件/失败模式）',
      patterns: [
        /注意(事项|点)?/,
        /caveat|pitfall|gotcha|warning/i,
        /边界|前置条件|失败|回滚|超时|并发/,
        /##\s*(注意|边界|风险|限制)/,
      ],
    },
    {
      id: 'redlines',
      label: '红线规避（禁止项/必须项/错误做法）',
      patterns: [
        /红线|禁止|必须|不要|切勿|严禁/,
        /do\s*not|must\s*not|never|forbidden|red\s*line/i,
        /规避|反模式|错误做法/,
        /##\s*(红线|禁止|规避|反模式)/,
      ],
    },
  ];

const VAGUE_ONLY = [
  /总[体而]来说/,
  /简单来说/,
  /大致(上|就是)/,
  /主要是/,
  /一般来说/,
  /可以考虑/,
  /建议采用/,
  /in\s+summary/i,
  /high[- ]level/i,
  /at\s+a\s+high\s+level/i,
];

/**
 * Validate capture content: detailed enough, and scoped to one knowledge point.
 * Overview hubs must stay thin and link children via `related`.
 */
export function assessCaptureQuality(
  content: string,
  type: KnowledgeType,
  options: CaptureQualityOptions = {},
): CaptureQualityResult {
  const reasons: string[] = [];
  const hints: string[] = [];
  const text = content.trim();
  const title = (options.title ?? '').trim();
  const related = options.related ?? [];
  const links = options.links ?? [];
  const anchors = options.anchors ?? [];
  const overview = isOverviewCard(title, text);
  const incremental = Boolean(options.incremental);
  const typeDef = options.typeDef;
  const profile =
    typeDef?.legacyProfile ??
    (type === PROBLEM_TYPE
      ? 'problem'
      : type === OUTCOME_TYPE
        ? 'outcome'
        : FEATURE_LIKE.has(type)
          ? 'feature'
          : typeDef
            ? undefined
            : 'solution');

  const ruleMin = typeDef?.rules.find(
    (r): r is { minBodyChars: number } => 'minBodyChars' in r,
  )?.minBodyChars;
  const ruleMax = typeDef?.rules.find(
    (r): r is { maxBodyChars: number } => 'maxBodyChars' in r,
  )?.maxBodyChars;

  const minChars = overview
    ? MIN_CHARS_OVERVIEW
    : (ruleMin ??
      (profile === 'feature' ? MIN_CHARS_FEATURE : MIN_CHARS_DEFAULT));
  const maxChars =
    overview
      ? MAX_CHARS_OVERVIEW
      : (ruleMax ?? MAX_CHARS_DETAIL);

  if (text.length < minChars) {
    reasons.push(
      `正文过短（${text.length} < ${minChars} 字）：需要明细描述，禁止一句话总结`,
    );
  }
  if (text.length > maxChars) {
    reasons.push(
      overview
        ? `总览卡过长（${text.length} > ${maxChars} 字）：总览只保留导航/阶段表，实现细节拆成子节点并用 related 关联`
        : `单卡过长（${text.length} > ${maxChars} 字）：一卡一事，请拆成多条知识节点并用 related 串联`,
    );
  }

  const covered = DETAIL_FAMILIES.filter((f) =>
    f.patterns.some((p) => p.test(text)),
  );
  const coveredIds = new Set(covered.map((f) => f.id));

  // Overview cards: allow thinner detail if they declare related children.
  if (!overview) {
    if (profile === 'problem') {
      if (!/(症状|复现|现象|触发|impact|symptom|repro)/i.test(text)) {
        reasons.push(
          'problem 卡须写清症状/复现/触发条件（可独立跟踪的未解问题，不要塞解决方案）',
        );
      }
      if (!/(验收|未解决|仍存在|open|待确认|如何算解决)/i.test(text)) {
        reasons.push(
          'problem 卡须写清「如何算已解决」的验收标准，便于 outcome/verifies 闭环',
        );
      }
      if (/解决方案|已修复|改用/.test(text) && text.length > 800) {
        hints.push(
          '若已有方案，请拆成 problem_solution + links:[{relation:solves}]→本问题，勿把方案写进 problem 卡',
        );
      }
    } else if (profile === 'outcome') {
      if (!/(结果|验证|上线|指标|通过|失败|证据|evidence|verified)/i.test(text)) {
        reasons.push('outcome 卡须写清实施/验证结果与证据（命令输出、指标、日期）');
      }
      if (!coveredIds.has('redlines') && !coveredIds.has('cautions')) {
        reasons.push('outcome 卡须注明残留风险或回滚注意（或明确「无残留风险」）');
      }
      if (!links.some((l) => l.relation === 'verifies')) {
        reasons.push(
          'outcome 卡须 links:[{id:问题id, relation:"verifies"}]，用于确认问题是否已解决',
        );
      }
    } else if (profile === 'feature') {
      for (const f of DETAIL_FAMILIES) {
        if (!coveredIds.has(f.id)) {
          reasons.push(
            `功能/设计类条目缺少「${f.label}」——请写清具体做法，勿空泛概述`,
          );
        }
      }
    } else if (profile === 'solution') {
      // problem_solution / pitfall
      if (!coveredIds.has('implementation')) {
        reasons.push(
          '缺少可执行解法/复现步骤（命令、配置、代码路径或逐步操作）',
        );
      }
      if (!coveredIds.has('cautions') && !coveredIds.has('redlines')) {
        reasons.push('缺少注意事项或红线规避（以后如何不再踩坑）');
      }
      if (
        type === 'problem_solution' &&
        !links.some((l) => l.relation === 'solves') &&
        related.length === 0
      ) {
        hints.push(
          '建议 links:[{id:问题id, relation:"solves"}] 挂到 problem，便于确认是否已解决',
        );
      }
    }

    if (profile !== 'problem') {
      const concrete = hasConcreteSignals(text);
      if (!concrete && (profile === 'feature' || profile === 'solution' || profile === 'outcome')) {
        reasons.push(
          '缺少可核对细节（文件路径、符号名、命令、配置键、编号步骤或代码块）——不要只写抽象结论',
        );
      }
    } else if (!hasConcreteSignals(text) && !/(步骤|环境|版本)/.test(text)) {
      reasons.push('problem 卡缺少可核对细节（环境、版本、复现步骤或路径）');
    }

    // Architecture-like cards must cite code (forces dig, not catalog prose).
    const needsCitationByType =
      type === 'architecture_design' ||
      type === 'tool_usage' ||
      type === 'code_snippet' ||
      type === 'process_spec';
    const needsCitationByRule = typeDef?.rules.some(
      (r) => 'requireCodeCitation' in r && r.requireCodeCitation,
    );
    if ((needsCitationByType || needsCitationByRule) && !hasCodeCitation(text, anchors)) {
      reasons.push(
        '架构/流程/工具类必须含代码锚点（## 代码锚点、path/file.ext、符号名，或 capture.anchors）——请先 Codegraph/读码再写，禁止目录级空文',
      );
    }

    applyRegistryTypeRules(text, typeDef, {
      reasons,
      hints,
      coveredIds,
      links,
      anchors,
      skipMinMax: true,
      skipCodeCitation: Boolean(needsCitationByType || needsCitationByRule),
    });

    // Fake "one topic": whole pipeline S0…S10 in one card.
    if (/S0[\s\S]{0,80}S10|S0\s*[→\-~]+\s*S10/i.test(text) && text.length > 900) {
      reasons.push(
        '检测到整段 S0–S10 塞进单卡：请拆成各阶段/节点专项明细卡，再用总览 related 串联',
      );
    }

    // Incremental: must join existing project graph without user reminding.
    if (incremental) {
      const attached =
        related.length > 0 ||
        links.some((l) => l.relation === 'part_of' || l.relation === 'related_to' || l.relation === 'derives_from' || l.relation === 'solves' || l.relation === 'verifies');
      if (!attached) {
        const hubHint =
          options.hubIds && options.hubIds.length > 0
            ? `；建议挂到总览 ${options.hubIds.slice(0, 3).join(', ')}`
            : '；先 kmind_search 本 project 总览/相关卡再 related 或 links.part_of';
        reasons.push(
          `增量写入必须挂图（related[] 或 links）接到本 project 已有节点${hubHint}`,
        );
      }
    }
  } else {
    // Overview still needs a minimal guardrail + map signal.
    if (!coveredIds.has('redlines') && !coveredIds.has('cautions')) {
      reasons.push('总览卡至少写清一条顺序/边界红线或注意事项');
    }
    if (related.length === 0) {
      reasons.push(
        '总览卡必须传 related[] 指向子节点（或先写子节点再写总览并回填）；禁止把多主题实现塞进一张总览',
      );
    }
  }

  const vagueHits = VAGUE_ONLY.filter((p) => p.test(text)).length;
  if (vagueHits >= 2 && text.length < minChars * 2) {
    reasons.push(
      '文风偏总结概括（出现多次「总的来说/简单来说/…」），请改成可操作明细',
    );
  }

  // —— Scope: one knowledge point per node ——
  const topicH2 = listTopicHeadings(text);
  const maxTopic = overview ? MAX_TOPIC_H2_OVERVIEW : MAX_TOPIC_H2_DETAIL;
  if (topicH2.length > maxTopic) {
    reasons.push(
      `范围过大：检测到 ${topicH2.length} 个主题小节（${topicH2.slice(0, 5).join('、')}${topicH2.length > 5 ? '…' : ''}），上限 ${maxTopic}。请一卡一事拆分，并用 related 关联`,
    );
  }

  const componentBlobs = countComponentBlobs(text);
  if (componentBlobs > MAX_COMPONENT_BLOBS) {
    reasons.push(
      `范围过大：同卡展开了约 ${componentBlobs} 个组件/模块实现（上限 ${MAX_COMPONENT_BLOBS}）。每个组件单独建节点；总览只列名称+related`,
    );
  }

  if (reasons.length === 0 && !overview && !coveredIds.has('redlines')) {
    hints.push('建议补一节「红线/禁止」：写清绝对不能做什么');
  }
  if (reasons.length === 0 && overview && related.length > 0) {
    hints.push('总览卡请保持薄：阶段表/索引即可，细节放在 related 子节点');
  }

  return { ok: reasons.length === 0, reasons, hints };
}

/**
 * Apply ADR-001 whitelist rules + requiredSections from AssetTypeDef.
 */
function applyRegistryTypeRules(
  text: string,
  typeDef: AssetTypeDef | undefined,
  ctx: {
    reasons: string[];
    hints: string[];
    coveredIds: Set<string>;
    links: Array<{ id: string; relation: string }>;
    anchors: Array<{ file?: string; symbol?: string }>;
    skipMinMax?: boolean;
    skipCodeCitation?: boolean;
  },
): void {
  if (!typeDef) return;

  for (const section of typeDef.requiredSections) {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^##\\s+${escaped}\\b`, 'im');
    if (!re.test(text)) {
      ctx.reasons.push(`缺少必填段落「## ${section}」（类型 ${typeDef.id}）`);
    }
  }

  for (const rule of typeDef.rules) {
    if (ctx.skipMinMax && ('minBodyChars' in rule || 'maxBodyChars' in rule)) {
      continue;
    }
    if ('minBodyChars' in rule && text.length < rule.minBodyChars) {
      ctx.reasons.push(
        `正文过短（${text.length} < ${rule.minBodyChars} 字，类型 ${typeDef.id}）`,
      );
    }
    if ('maxBodyChars' in rule && text.length > rule.maxBodyChars) {
      ctx.reasons.push(
        `正文过长（${text.length} > ${rule.maxBodyChars} 字，类型 ${typeDef.id}）`,
      );
    }
    if ('requireDetailFamilies' in rule) {
      for (const id of rule.requireDetailFamilies) {
        if (!ctx.coveredIds.has(id)) {
          const label =
            DETAIL_FAMILIES.find((f) => f.id === id)?.label ?? id;
          ctx.reasons.push(`缺少「${label}」（类型 ${typeDef.id}）`);
        }
      }
    }
    if ('requireLinkRelation' in rule) {
      if (!ctx.links.some((l) => l.relation === rule.requireLinkRelation)) {
        ctx.reasons.push(
          `须 links 含 relation:"${rule.requireLinkRelation}"（类型 ${typeDef.id}）`,
        );
      }
    }
    if ('hintLinkRelation' in rule) {
      if (!ctx.links.some((l) => l.relation === rule.hintLinkRelation)) {
        ctx.hints.push(
          `建议 links:[{relation:"${rule.hintLinkRelation}"}]（类型 ${typeDef.id}）`,
        );
      }
    }
    if (
      'requireCodeCitation' in rule &&
      rule.requireCodeCitation &&
      !ctx.skipCodeCitation &&
      !hasCodeCitation(text, ctx.anchors)
    ) {
      ctx.reasons.push(
        `须含代码锚点（类型 ${typeDef.id}）`,
      );
    }
    if ('requireConcreteSignals' in rule && rule.requireConcreteSignals) {
      if (!hasConcreteSignals(text)) {
        ctx.reasons.push(
          `缺少可核对细节（类型 ${typeDef.id}）`,
        );
      }
    }
    if ('requirePatterns' in rule) {
      const ok = rule.requirePatterns.some((p) => {
        try {
          return new RegExp(p, 'i').test(text);
        } catch {
          return false;
        }
      });
      if (!ok) ctx.reasons.push(rule.message);
    }
  }
}

function isOverviewCard(title: string, body: string): boolean {
  // Title is authoritative — body may discuss「总览卡」rules without being a hub.
  if (isOverviewTitle(title)) return true;
  // Only the opening heading line may mark an untitled hub paste.
  const firstH2 = body.match(/^##\s+(.+)$/m)?.[1] ?? '';
  return /总览|概览|索引|地图|overview|index\s*card/i.test(firstH2);
}

/**
 * H2 headings that represent distinct topics (excludes structural template sections).
 */
export function listTopicHeadings(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^##\s+(.+)$/gm)) {
    const raw = (m[1] ?? '').trim();
    const name = raw.replace(/[（(].*$/, '').trim();
    if (!name || STRUCTURAL_H2.test(name)) continue;
    // "核心组件（实现方式）" is a multi-topic dump signal — count as topic.
    out.push(name);
  }
  return out;
}

/**
 * Count component/module implementation blobs like `FooBar（path/x.py）`.
 */
export function countComponentBlobs(text: string): number {
  const patterns = [
    /[A-Z][A-Za-z0-9]+(?:Engine|Orchestrator|Factory|Modeler|Library|Registry|Service|Client|Handler)\s*[（(][^）)]+[）)]/g,
    /[-*]\s+[A-Z][A-Za-z0-9_]+\s*[（(][\w./-]+\.(?:py|ts|tsx|js|go)[）)]/g,
  ];
  const found = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      found.add(m[0].replace(/\s+/g, ' ').slice(0, 80));
    }
  }
  return found.size;
}

function hasConcreteSignals(text: string): boolean {
  const signals = [
    /```[\s\S]{20,}?```/,
    /`[^`]{3,}`/,
    /\b[\w./-]+\.(ts|tsx|js|py|go|java|rs|sql|yml|yaml|json|md)\b/i,
    /\b[A-Z][A-Za-z0-9]+(?:[./][A-Za-z0-9_]+){1,}/,
    /(?:^|\n)\s*\d+[.)、]\s+\S+/m,
    /(?:^|\n)\s*[-*]\s+\S{8,}/m,
    /(?:pnpm|npm|yarn|git|curl|docker|kubectl|uv)\s+\S+/i,
    /(?:必须|禁止|不要|切勿).{4,}/,
  ];
  return signals.filter((p) => p.test(text)).length >= 2;
}

/** True if body or anchors cite real code locations. */
export function hasCodeCitation(
  text: string,
  anchors: Array<{ file?: string; symbol?: string }> = [],
): boolean {
  if (anchors.some((a) => Boolean(a.file?.trim()))) return true;
  if (/##\s*代码锚点/.test(text)) return true;
  if (
    /\b[\w./-]+\.(ts|tsx|js|jsx|py|go|java|rs|sql|yml|yaml)\b/.test(text) &&
    (/`[A-Za-z_][\w.]*`/.test(text) ||
      /\b[A-Z][A-Za-z0-9]+(?:[./][A-Za-z0-9_]+){1,}/.test(text) ||
      /:\d{1,5}\b/.test(text))
  ) {
    return true;
  }
  return false;
}

export function isOverviewTitle(title: string): boolean {
  return /总览|概览|索引|地图|overview|index\s*card|导航/i.test(title);
}
