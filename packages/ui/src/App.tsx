import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAsset,
  fetchCoverage,
  fetchEgo,
  fetchEgoHealth,
  fetchGlobalGraph,
  fetchHealth,
  fetchStatus,
  listAssets,
  searchAssets,
  type AssetDetail,
  type CodeAnchor,
  type CoverageSummary,
  type EgoGraph,
  type HealthIssue,
  type HealthSummary,
  type SearchHit,
  type VaultStatus,
} from './api';
import { GraphView } from './GraphView';
import { FocusMarkdown } from './FocusMarkdown';
import { RELATION_COLOR, RELATION_LEGEND } from './relationColors';

type ViewMode = 'ego' | 'global';
type HudTab = 'read' | 'extend' | 'health';

function readFocusFromUrl(): string | null {
  const v = new URLSearchParams(window.location.search).get('focus');
  return v?.trim() || null;
}

function writeFocusToUrl(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('focus', id);
  else url.searchParams.delete('focus');
  window.history.replaceState({}, '', url);
}

/**
 * KMind local UI: search → read body → extend (Hop1) → optional graph/health.
 */
export function App() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(() => readFocusFromUrl());
  const [depth, setDepth] = useState(1);
  const [mode, setMode] = useState<ViewMode>(() =>
    readFocusFromUrl() ? 'ego' : 'global',
  );
  const [hudTab, setHudTab] = useState<HudTab>('read');
  const [showGraph, setShowGraph] = useState(false);
  const [showFarIssues, setShowFarIssues] = useState(false);
  const [projectFilter, setProjectFilter] = useState('');
  const [graph, setGraph] = useState<EgoGraph | null>(null);
  const [egoIssues, setEgoIssues] = useState<HealthIssue[]>([]);
  const [egoByRule, setEgoByRule] = useState<Record<string, number>>({});
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [healthRuleFilter, setHealthRuleFilter] = useState<string | null>(null);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusAsset, setFocusAsset] = useState<AssetDetail | null>(null);
  const [coverage, setCoverage] = useState<CoverageSummary | null>(null);

  useEffect(() => {
    void fetchStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    void fetchHealth()
      .then(setHealth)
      .catch(() => {
        /* non-fatal */
      });
    void listAssets(20)
      .then((r) => setRecent(r.results))
      .catch(() => {
        /* non-fatal */
      });
  }, []);

  const loadFocus = useCallback(async (id: string, hop: number) => {
    setLoading(true);
    setError(null);
    try {
      const [g, h, asset] = await Promise.all([
        fetchEgo(id, hop),
        fetchEgoHealth(id, hop),
        fetchAsset(id).catch(() => null),
      ]);
      setGraph(g);
      setEgoIssues(h.issues);
      setEgoByRule(h.byRule);
      setFocusAsset(asset);
      setFocusId(id);
      writeFocusToUrl(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGlobal = useCallback(async (project: string) => {
    setLoading(true);
    setError(null);
    try {
      const g = await fetchGlobalGraph({
        cap: 300,
        project: project.trim() || undefined,
      });
      setGraph(g);
      setEgoIssues([]);
      setEgoByRule({});
      setFocusAsset(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'ego' && focusId) {
      void loadFocus(focusId, depth);
    } else if (mode === 'global') {
      void loadGlobal(projectFilter);
    }
  }, [mode, focusId, depth, projectFilter, loadFocus, loadGlobal]);

  useEffect(() => {
    if (mode !== 'ego' || !focusAsset?.project) {
      setCoverage(null);
      return;
    }
    const topic = guessTopic(focusAsset.title);
    let cancelled = false;
    void fetchCoverage({
      project: focusAsset.project,
      ...(topic ? { topic } : {}),
      hubId: focusAsset.id,
    })
      .then((r) => {
        if (!cancelled) setCoverage(r);
      })
      .catch(() => {
        if (!cancelled) setCoverage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, focusAsset?.id, focusAsset?.project, focusAsset?.title]);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchAssets(query.trim())
        .then((r) => {
          setHits(r.results);
          setShowHits(true);
        })
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : String(e)),
        );
    }, 220);
    return () => window.clearTimeout(t);
  }, [query]);

  const focusNode = useMemo(
    () =>
      graph?.focusId
        ? (graph.nodes.find((n) => n.id === graph.focusId) ?? null)
        : null,
    [graph],
  );

  const focusAnchors: CodeAnchor[] = useMemo(() => {
    const raw = focusAsset?.metadata?.codeAnchors;
    return Array.isArray(raw) ? raw : [];
  }, [focusAsset]);

  const topRule =
    Object.entries(egoByRule).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const focusIssues = useMemo(
    () =>
      graph
        ? egoIssues.filter((i) => i.assetId === graph.focusId)
        : [],
    [egoIssues, graph],
  );

  const hop1Issues = useMemo(() => {
    if (!graph) return [];
    const hop1 = new Set(
      graph.nodes.filter((n) => n.hop === 1).map((n) => n.id),
    );
    return egoIssues.filter(
      (i) => i.assetId && (i.assetId === graph.focusId || hop1.has(i.assetId)),
    );
  }, [egoIssues, graph]);

  /** Focus card quality — not neighborhood noise. */
  const focusQuality = useMemo(() => {
    let score = 100;
    for (const i of focusIssues) {
      if (i.severity === 'high') score -= 25;
      else if (i.severity === 'medium') score -= 15;
      else score -= 8;
    }
    if (
      focusNode &&
      (focusNode.type === 'architecture_design' ||
        focusNode.type === 'code_snippet') &&
      !(focusNode.hasCodeAnchors || focusAnchors.length > 0)
    ) {
      score -= 20;
    }
    return Math.max(0, Math.min(100, score));
  }, [focusIssues, focusNode, focusAnchors.length]);

  const neighborhood = useMemo(() => {
    if (!graph || mode !== 'ego') return null;
    const byHop: Record<number, number> = {};
    const byType: Record<string, number> = {};
    for (const n of graph.nodes) {
      byHop[n.hop] = (byHop[n.hop] ?? 0) + 1;
      byType[n.type] = (byType[n.type] ?? 0) + 1;
    }
    const scoped = depth <= 1 ? hop1Issues : egoIssues;
    const issueFlagged = graph.nodes.filter((n) => {
      if (depth <= 1 && n.hop > 1) return false;
      return n.hasHealthIssue;
    }).length;
    let integrity = 100;
    for (const i of scoped) {
      if (i.severity === 'high') integrity -= 12;
      else if (i.severity === 'medium') integrity -= 6;
      else integrity -= 2;
    }
    integrity = Math.max(0, Math.round(integrity - issueFlagged * 3));
    return {
      byHop,
      byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
      linkCount: graph.links.length,
      issueFlagged,
      integrity,
      scopedIssueCount: scoped.length,
    };
  }, [graph, egoIssues, hop1Issues, mode, depth]);

  /** Hop1 neighbors grouped by relation from/to focus. */
  const extendGroups = useMemo(() => {
    if (!graph?.focusId) return [];
    const hop1 = graph.nodes.filter((n) => n.hop === 1);
    const byId = new Map(hop1.map((n) => [n.id, n]));
    const groups = new Map<string, Array<{ id: string; title: string; type: string }>>();
    const push = (rel: string, id: string) => {
      const n = byId.get(id);
      if (!n) return;
      const list = groups.get(rel) ?? [];
      if (!list.some((x) => x.id === id)) {
        list.push({ id: n.id, title: n.title, type: n.type });
      }
      groups.set(rel, list);
    };
    for (const link of graph.links) {
      if (link.source === graph.focusId && byId.has(link.target)) {
        push(link.relationType || 'related_to', link.target);
      } else if (link.target === graph.focusId && byId.has(link.source)) {
        push(link.relationType || 'related_to', link.source);
      }
    }
    for (const n of hop1) {
      if (![...groups.values()].some((list) => list.some((x) => x.id === n.id))) {
        push('related_to', n.id);
      }
    }
    const order = [
      'part_of',
      'derives_from',
      'supersedes',
      'solves',
      'verifies',
      'results_in',
      'related_to',
      'contradicts',
    ];
    return order
      .filter((k) => (groups.get(k)?.length ?? 0) > 0)
      .map((k) => ({ relation: k, items: groups.get(k)! }));
  }, [graph]);

  const linkTypeCounts = useMemo(() => {
    if (!graph) return [];
    const counts = new Map<string, number>();
    for (const l of graph.links) {
      const rel = l.relationType || 'related_to';
      counts.set(rel, (counts.get(rel) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  const farIssues = useMemo(() => {
    if (!graph) return [];
    const near = new Set(
      graph.nodes.filter((n) => n.hop <= 1).map((n) => n.id),
    );
    return egoIssues.filter((i) => i.assetId && !near.has(i.assetId));
  }, [egoIssues, graph]);

  const vaultRuleEntries = useMemo(() => {
    if (!health) return [];
    return Object.entries(health.byRule).sort((a, b) => b[1] - a[1]);
  }, [health]);

  const displayedVaultIssues = useMemo(() => {
    if (!health) return [];
    if (!healthRuleFilter) return health.issues;
    return health.issues.filter((i) => i.rule === healthRuleFilter);
  }, [health, healthRuleFilter]);

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const h of recent) {
      if (h.project) set.add(h.project);
    }
    for (const n of graph?.nodes ?? []) {
      if (n.project) set.add(n.project);
    }
    return [...set].sort();
  }, [recent, graph]);

  const dropdownItems = query.trim() ? hits : recent;
  const showDropdown = showHits && dropdownItems.length > 0;

  const enterEgo = (id: string) => {
    setMode('ego');
    setFocusId(id);
    setHudTab('read');
    setShowGraph(false);
    setShowFarIssues(false);
    writeFocusToUrl(id);
  };

  const pickAsset = (h: SearchHit) => {
    setQuery('');
    setShowHits(false);
    enterEgo(h.id);
  };

  const switchToGlobal = () => {
    setMode('global');
    setFocusId(null);
    writeFocusToUrl(null);
  };

  const issueCount =
    health?.totalIssueCount ?? health?.issueCount ?? 0;

  return (
    <div className="app">
      <div className="stage-grid" aria-hidden />
      <header className="topbar">
        <div className="brand">
          <strong>KMind</strong>
          <span>INSTRUMENT</span>
        </div>
        <div className="mode-toggle" role="group" aria-label="图谱模式">
          <button
            type="button"
            className={mode === 'ego' ? 'active' : ''}
            onClick={() => {
              if (focusId) setMode('ego');
              else if (recent[0]) enterEgo(recent[0].id);
            }}
            disabled={!focusId && recent.length === 0}
          >
            Ego
          </button>
          <button
            type="button"
            className={mode === 'global' ? 'active' : ''}
            onClick={switchToGlobal}
          >
            Global
          </button>
        </div>
        <div className="search-shell">
          <span className="search-prefix" aria-hidden>
            /
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setShowHits(true)}
            onBlur={() => window.setTimeout(() => setShowHits(false), 180)}
            placeholder="搜索或点击列出资产…"
            aria-label="搜索知识资产"
          />
          {showDropdown && (
            <div className="results" role="listbox">
              {!query.trim() && (
                <div className="results-label">最近资产 · {recent.length}</div>
              )}
              {dropdownItems.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="result"
                  role="option"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickAsset(h)}
                >
                  <strong>{h.title}</strong>
                  <em>
                    {h.type} · {h.project} · {h.id}
                  </em>
                </button>
              ))}
            </div>
          )}
        </div>
        {mode === 'global' && (
          <label className="project-filter">
            <span>project</span>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="按项目过滤全局图"
            >
              <option value="">全部</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="meta-chip">
          <div className="chip" title="知识资产数量">
            assets <strong>{status?.assetCount ?? '—'}</strong>
          </div>
          <div className="chip" title="健康告警数量（0=无告警，不是没数据）">
            issues <strong>{issueCount}</strong>
          </div>
        </div>
      </header>

      {graph && mode === 'ego' && showGraph && (
        <div className="shell-legend" aria-hidden>
          <span>
            <i className="dot hop0" /> hop 0
          </span>
          <span>
            <i className="dot hop1" /> hop 1
          </span>
          <span>
            <i className="dot hop2" /> hop 2+
          </span>
          <span>
            <i className="dot code-anchor" /> anchors
          </span>
          {RELATION_LEGEND.filter((r) =>
            linkTypeCounts.some(([k]) => k === r),
          ).map((rel) => (
            <span key={rel}>
              <i
                className="dot"
                style={{ background: RELATION_COLOR[rel], color: RELATION_COLOR[rel] }}
              />{' '}
              {rel}
            </span>
          ))}
        </div>
      )}
      {graph && mode === 'global' && (
        <div className="shell-legend" aria-hidden>
          <span>
            <i className="dot problem" /> problem
          </span>
          <span>
            <i className="dot hop0" /> type / linked
          </span>
          <span>
            <i className="dot code-anchor" /> code anchors
          </span>
          <span>
            <i className="dot health" /> health
          </span>
          <span className="legend-note">Global · 全库巡检</span>
        </div>
      )}

      <div
        className={
          mode === 'ego' && focusAsset && !showGraph
            ? 'stage stage-compact'
            : 'stage'
        }
      >
        {mode === 'ego' && focusAsset && !showGraph ? (
          <div className="reader-main" aria-label="知识正文">
            <header className="reader-head">
              <h1>{focusAsset.title}</h1>
              <p className="reader-meta">
                {focusAsset.type} · {focusAsset.project} · {focusAsset.id}
              </p>
              <div className="reader-actions">
                <button type="button" onClick={() => setShowGraph(true)}>
                  显示图谱
                </button>
                <button type="button" onClick={() => setHudTab('extend')}>
                  延伸阅读
                </button>
              </div>
            </header>
            {focusAsset.body ? (
              <FocusMarkdown source={focusAsset.body} />
            ) : (
              <p className="warn">无正文</p>
            )}
          </div>
        ) : graph ? (
          <GraphView
            graph={graph}
            mode={mode}
            onSelect={(id) => {
              enterEgo(id);
            }}
          />
        ) : (
          <div className="empty">
            <div>
              <h1>
                {mode === 'global' ? '全库图谱巡检' : '搜索并打开一张知识'}
              </h1>
              <p>
                {mode === 'global'
                  ? 'Global 模式用于 vault 健康与全图浏览；要读正文请切回 Ego 并搜索焦点卡。'
                  : 'Ego 阅读模式：主栏正文 → 侧栏延伸/健康；图谱按需打开（默认 Hop1）。'}
              </p>
            </div>
          </div>
        )}
      </div>

      <aside
        className="hud"
        aria-label={mode === 'global' ? '全库巡检面板' : '阅读与延伸面板'}
      >
        {(mode === 'global' || !graph) && health && (
          <section className="panel vault-health-panel">
            <h2>Vault 巡检</h2>
            <p className="health-status">Global · 运维视角（非单卡阅读）</p>
            <div className="summary-grid">
              <div>
                integrity
                <strong className={issueCount === 0 ? 'ok' : 'bad'}>
                  {issueCount === 0
                    ? '100%'
                    : `${Math.max(0, 100 - issueCount * 10)}%`}
                </strong>
              </div>
              <div>
                alerts
                <strong className={issueCount === 0 ? 'ok' : 'bad'}>
                  {issueCount}
                </strong>
              </div>
            </div>
            <p className="health-status">
              {issueCount === 0
                ? 'Vault 完整 · 无健康告警'
                : `${vaultRuleEntries.length} rules · 显示 ${displayedVaultIssues.length}`}
            </p>
            <div className="kv" style={{ marginTop: '0.6rem' }}>
              <span>checked</span>
              <b>{new Date(health.checkedAt).toLocaleString()}</b>
            </div>

            {vaultRuleEntries.length > 0 && (
              <>
                <h3 className="subhead">按规则</h3>
                <div className="rule-chips">
                  <button
                    type="button"
                    className={healthRuleFilter == null ? 'active' : ''}
                    onClick={() => setHealthRuleFilter(null)}
                  >
                    全部
                  </button>
                  {vaultRuleEntries.map(([rule, n]) => (
                    <button
                      key={rule}
                      type="button"
                      className={healthRuleFilter === rule ? 'active' : ''}
                      onClick={() =>
                        setHealthRuleFilter(
                          healthRuleFilter === rule ? null : rule,
                        )
                      }
                    >
                      {rule} · {n}
                    </button>
                  ))}
                </div>
              </>
            )}

            {displayedVaultIssues.length > 0 && (
              <ul className="issue-list">
                {displayedVaultIssues.slice(0, 60).map((issue, i) => (
                  <li key={`${issue.rule}-${issue.assetId ?? i}-${i}`}>
                    <div
                      className={`rule ${
                        issue.severity === 'high'
                          ? 'sev-high'
                          : issue.severity === 'medium'
                            ? 'sev-med'
                            : ''
                      }`}
                    >
                      {issue.rule} · {issue.severity}
                    </div>
                    <div>{issue.message}</div>
                    {issue.assetId && (
                      <button
                        type="button"
                        onClick={() => enterEgo(issue.assetId!)}
                      >
                        → {issue.assetId}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {mode === 'global' && graph && (
              <div className="kv" style={{ marginTop: '0.75rem' }}>
                <span>graph nodes</span>
                <b>
                  {graph.nodes.length}
                  {graph.truncated ? ` / ${graph.totalCandidates}` : ''}
                </b>
              </div>
            )}
            {loading && mode === 'global' && (
              <p className="warn">加载中…</p>
            )}
          </section>
        )}

        {mode === 'ego' && graph && (
          <>
            <div className="hud-tabs" role="tablist" aria-label="侧栏模式">
              {(
                [
                  ['read', '阅读'],
                  ['extend', '延伸'],
                  ['health', '健康'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={hudTab === id}
                  className={hudTab === id ? 'active' : ''}
                  onClick={() => setHudTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {hudTab === 'read' && (
              <section className="panel" style={{ flex: 1, minHeight: 0 }}>
                <h2>Focus</h2>
                <p className="focus-title">
                  {focusNode?.title ?? graph.focusId}
                </p>
                <div className="summary-grid">
                  <div>
                    focus
                    <strong
                      className={
                        focusQuality >= 90
                          ? 'ok'
                          : focusQuality >= 60
                            ? 'warn-val'
                            : 'bad'
                      }
                    >
                      {focusQuality}%
                    </strong>
                  </div>
                  <div>
                    anchors
                    <strong>
                      {focusAnchors.length ||
                        (focusNode?.hasCodeAnchors ? 'body' : 0)}
                    </strong>
                  </div>
                </div>
                <p className="health-status">
                  本卡完整度（不含二跳邻域噪声）
                </p>
                <div className="kv">
                  <span>type</span>
                  <b>{focusNode?.type ?? '—'}</b>
                </div>
                <div className="kv">
                  <span>id</span>
                  <b>{graph.focusId}</b>
                </div>
                {focusAnchors.length > 0 && (
                  <ul className="anchor-list">
                    {focusAnchors.slice(0, 8).map((a, i) => (
                      <li key={`${a.file}-${a.symbol ?? ''}-${a.line ?? i}`}>
                        <code>
                          {a.file}
                          {a.line != null ? `:${a.line}` : ''}
                        </code>
                        {(a.symbol || a.kind) && (
                          <span>
                            {[a.symbol, a.kind].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {showGraph && (
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => setShowGraph(false)}
                  >
                    返回正文阅读
                  </button>
                )}
                {!showGraph && focusAsset?.body && (
                  <p className="anchor-hint">正文在左侧主栏；此处为摘要与锚点。</p>
                )}
                {loading && <p className="warn">加载中…</p>}
              </section>
            )}

            {hudTab === 'extend' && (
              <section className="panel" style={{ flex: 1, minHeight: 0 }}>
                <h2>延伸阅读</h2>
                <p className="health-status">Hop1 · 按关系分组</p>
                <div className="depth-row" role="group" aria-label="跳数深度">
                  {[1, 2, 3].map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={depth === d ? 'active' : ''}
                      onClick={() => setDepth(d)}
                    >
                      hop {d}
                    </button>
                  ))}
                </div>
                {extendGroups.length === 0 && (
                  <p className="warn">一度邻居为空；可提高 hop 或检查 related。</p>
                )}
                {extendGroups.map((g) => (
                  <div key={g.relation} className="extend-group">
                    <h3 className="subhead">{g.relation}</h3>
                    <ul className="extend-list">
                      {g.items.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setHudTab('read');
                              setShowGraph(false);
                              enterEgo(item.id);
                            }}
                          >
                            <strong>{item.title}</strong>
                            <em>
                              {item.type} · {item.id}
                            </em>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )}

            {hudTab === 'health' && (
              <section className="panel" style={{ flex: 1, minHeight: 0 }}>
                <h2>健康 · 覆盖</h2>
                {coverage && (
                  <div className="coverage-box">
                    <div className="summary-grid">
                      <div>
                        coverage
                        <strong className={coverage.complete ? 'ok' : 'bad'}>
                          {coverage.complete ? '合格' : '未完成'}
                        </strong>
                      </div>
                      <div>
                        issues
                        <strong>{coverage.issueCount}</strong>
                      </div>
                    </div>
                    <p className="health-status">{coverage.summary}</p>
                    {coverage.nextActions.length > 0 && (
                      <>
                        <h3 className="subhead">next actions</h3>
                        <ul className="action-list">
                          {coverage.nextActions.slice(0, 5).map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {coverage.shallow.length > 0 && (
                      <>
                        <h3 className="subhead">浅卡</h3>
                        <ul className="extend-list">
                          {coverage.shallow.slice(0, 5).map((s) => (
                            <li key={s.id}>
                              <button
                                type="button"
                                onClick={() => enterEgo(s.id)}
                              >
                                <strong>{s.title}</strong>
                                <em>
                                  {s.chars} 字 · {s.id}
                                </em>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
                {neighborhood && (
                  <>
                    <div className="summary-grid">
                      <div>
                        focus
                        <strong
                          className={
                            focusQuality >= 90
                              ? 'ok'
                              : focusQuality >= 60
                                ? 'warn-val'
                                : 'bad'
                          }
                        >
                          {focusQuality}%
                        </strong>
                      </div>
                      <div>
                        邻域
                        <strong
                          className={
                            neighborhood.integrity >= 90
                              ? 'ok'
                              : neighborhood.integrity >= 60
                                ? 'warn-val'
                                : 'bad'
                          }
                        >
                          {neighborhood.integrity}%
                        </strong>
                      </div>
                    </div>
                    <p className="health-status">
                      Focus≠邻域 · hop≤{depth} 计分 · near alerts{' '}
                      {hop1Issues.length}
                      {topRule ? ` · top ${topRule}` : ''}
                    </p>
                    <div className="depth-row" role="group" aria-label="跳数深度">
                      {[1, 2, 3].map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={depth === d ? 'active' : ''}
                          onClick={() => {
                            setDepth(d);
                            setShowFarIssues(false);
                          }}
                        >
                          hop {d}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => setShowGraph(true)}
                    >
                      打开图谱
                    </button>
                    {linkTypeCounts.length > 0 && (
                      <>
                        <h3 className="subhead">边类型</h3>
                        {linkTypeCounts.slice(0, 8).map(([rel, n]) => (
                          <div className="kv" key={rel}>
                            <span>
                              <i
                                className="rel-swatch"
                                style={{
                                  background:
                                    RELATION_COLOR[rel] ?? '#7a8b9e',
                                }}
                              />{' '}
                              {rel}
                            </span>
                            <b>{n}</b>
                          </div>
                        ))}
                      </>
                    )}
                    <h3 className="subhead">邻域构成</h3>
                    <ul className="hop-bars">
                      {[0, 1, 2, 3]
                        .filter((h) => (neighborhood.byHop[h] ?? 0) > 0)
                        .map((h) => {
                          const count = neighborhood.byHop[h] ?? 0;
                          const pct = Math.round(
                            (count / graph.nodes.length) * 100,
                          );
                          return (
                            <li key={h}>
                              <span className={`hop-label hop-${h}`}>
                                hop {h}
                              </span>
                              <div className="bar-track">
                                <div
                                  className={`bar-fill hop-${h}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <b>{count}</b>
                            </li>
                          );
                        })}
                    </ul>
                  </>
                )}

                <h3 className="subhead">告警 · Focus + Hop1</h3>
                {hop1Issues.length > 0 ? (
                  <ul className="issue-list">
                    {hop1Issues.slice(0, 30).map((issue, i) => (
                      <li key={`near-${issue.rule}-${issue.assetId ?? i}-${i}`}>
                        <div
                          className={`rule ${issue.severity === 'high' ? 'sev-high' : ''}`}
                        >
                          {issue.rule} · {issue.severity}
                        </div>
                        <div>{issue.message}</div>
                        {issue.assetId &&
                          issue.assetId !== graph.focusId && (
                            <button
                              type="button"
                              onClick={() => enterEgo(issue.assetId!)}
                            >
                              → {issue.assetId}
                            </button>
                          )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="health-status">近邻无告警</p>
                )}

                {farIssues.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => setShowFarIssues((v) => !v)}
                    >
                      {showFarIssues
                        ? '收起 Hop2+ 告警'
                        : `显示更多 · Hop2+（${farIssues.length}）`}
                    </button>
                    {showFarIssues && (
                      <ul className="issue-list far-issues">
                        {farIssues.slice(0, 40).map((issue, i) => (
                          <li
                            key={`far-${issue.rule}-${issue.assetId ?? i}-${i}`}
                          >
                            <div className="rule">
                              {issue.rule} · {issue.severity}
                            </div>
                            <div>{issue.message}</div>
                            {issue.assetId && (
                              <button
                                type="button"
                                onClick={() => enterEgo(issue.assetId!)}
                              >
                                → {issue.assetId}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </aside>

      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}

/** Soft topic from titles like「广银落地范围与五题验收基线」→ 广银. */
function guessTopic(title: string): string | undefined {
  const t = title.trim();
  if (!t) return undefined;
  const m = t.match(/^([\u4e00-\u9fffA-Za-z0-9]{2,8})/);
  if (m?.[1] && /广银|问数|CCDP|Ontology|指标/.test(m[1])) return m[1];
  if (/广银/.test(t)) return '广银';
  if (/问数/.test(t)) return '问数';
  return undefined;
}
