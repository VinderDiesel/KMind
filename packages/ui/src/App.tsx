import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAsset,
  fetchEgo,
  fetchEgoHealth,
  fetchGlobalGraph,
  fetchHealth,
  fetchStatus,
  listAssets,
  searchAssets,
  type AssetDetail,
  type CodeAnchor,
  type EgoGraph,
  type HealthIssue,
  type HealthSummary,
  type SearchHit,
  type VaultStatus,
} from './api';
import { GraphView } from './GraphView';

type ViewMode = 'ego' | 'global';

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
 * KMind local UI shell: search → 3D ego/global → health HUD.
 */
export function App() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(() => readFocusFromUrl());
  const [depth, setDepth] = useState(2);
  const [mode, setMode] = useState<ViewMode>(() =>
    readFocusFromUrl() ? 'ego' : 'global',
  );
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

  const neighborhood = useMemo(() => {
    if (!graph || mode !== 'ego') return null;
    const byHop: Record<number, number> = {};
    const byType: Record<string, number> = {};
    for (const n of graph.nodes) {
      byHop[n.hop] = (byHop[n.hop] ?? 0) + 1;
      byType[n.type] = (byType[n.type] ?? 0) + 1;
    }
    const issueFlagged = graph.nodes.filter((n) => n.hasHealthIssue).length;
    const integrity = Math.max(
      0,
      Math.round(100 - egoIssues.length * 12 - issueFlagged * 8),
    );
    return {
      byHop,
      byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
      linkCount: graph.links.length,
      issueFlagged,
      integrity,
    };
  }, [graph, egoIssues.length, mode]);

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

      {graph && mode === 'ego' && (
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
            <i className="dot problem" /> problem
          </span>
          <span>
            <i className="dot code-anchor" /> code anchors
          </span>
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
        </div>
      )}

      <div className="stage">
        {graph ? (
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
              <h1>定位一个知识焦点</h1>
              <p>
                用顶部命令条搜索资产进入 Ego 邻域，或切换 Global 查看全库图谱。右侧
                HUD 显示健康告警。
              </p>
            </div>
          </div>
        )}
      </div>

      <aside className="hud" aria-label="健康与焦点面板">
        {(mode === 'global' || !graph) && health && (
          <section className="panel vault-health-panel">
            <h2>Vault health</h2>
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
            <section className="panel">
              <h2>Focus</h2>
              <p className="focus-title">{focusNode?.title ?? graph.focusId}</p>
              <div className="kv">
                <span>id</span>
                <b>{graph.focusId}</b>
              </div>
              <div className="kv">
                <span>type</span>
                <b>{focusNode?.type ?? '—'}</b>
              </div>
              <div className="kv">
                <span>nodes</span>
                <b>
                  {graph.nodes.length}
                  {graph.truncated ? ` / ${graph.totalCandidates}` : ''}
                </b>
              </div>
              <div className="kv">
                <span>code anchors</span>
                <b>{focusAnchors.length}</b>
              </div>
              {focusAnchors.length > 0 && (
                <ul className="anchor-list">
                  {focusAnchors.slice(0, 12).map((a, i) => (
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
              {focusAnchors.length > 0 && (
                <p className="anchor-hint">
                  影响面请用本机 Codegraph：
                  <code>codegraph_explore</code>（需项目{' '}
                  <code>.codegraph/</code>）
                </p>
              )}
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
              {graph.truncated && (
                <p className="warn">
                  邻域已截断至 {graph.nodeCap} 节点。降低 hop 或更换更窄的焦点。
                </p>
              )}
              {loading && <p className="warn">加载中…</p>}
            </section>

            <section className="panel" style={{ flex: 1, minHeight: 0 }}>
              <h2>Focus health</h2>
              {neighborhood && (
                <>
                  <div className="summary-grid">
                    <div>
                      integrity
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
                    <div>
                      alerts
                      <strong
                        className={egoIssues.length === 0 ? 'ok' : 'bad'}
                      >
                        {egoIssues.length}
                      </strong>
                    </div>
                  </div>

                  <div className="meter" aria-hidden>
                    <div
                      className={`meter-fill ${
                        neighborhood.integrity >= 90
                          ? 'ok'
                          : neighborhood.integrity >= 60
                            ? 'warn-val'
                            : 'bad'
                      }`}
                      style={{ width: `${neighborhood.integrity}%` }}
                    />
                  </div>

                  <p className="health-status">
                    {egoIssues.length === 0
                      ? '邻域完整 · 无健康告警'
                      : `top rule · ${topRule ?? '—'}`}
                  </p>

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
                            <span className={`hop-label hop-${h}`}>hop {h}</span>
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

                  <div className="kv">
                    <span>links</span>
                    <b>{neighborhood.linkCount}</b>
                  </div>
                  <div className="kv">
                    <span>flagged nodes</span>
                    <b>{neighborhood.issueFlagged}</b>
                  </div>
                  {neighborhood.byType.slice(0, 4).map(([type, n]) => (
                    <div className="kv" key={type}>
                      <span>{type}</span>
                      <b>{n}</b>
                    </div>
                  ))}
                </>
              )}

              {egoIssues.length > 0 && (
                <ul className="issue-list">
                  {egoIssues.slice(0, 40).map((issue, i) => (
                    <li key={`${issue.rule}-${issue.assetId ?? i}-${i}`}>
                      <div
                        className={`rule ${issue.severity === 'high' ? 'sev-high' : ''}`}
                      >
                        {issue.rule} · {issue.severity}
                      </div>
                      <div>{issue.message}</div>
                      {issue.assetId && issue.assetId !== graph.focusId && (
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
            </section>
          </>
        )}
      </aside>

      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
