import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchEgo,
  fetchEgoHealth,
  fetchHealth,
  fetchStatus,
  searchAssets,
  type EgoGraph,
  type HealthIssue,
  type HealthSummary,
  type SearchHit,
  type VaultStatus,
} from './api';
import { GraphView } from './GraphView';

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
 * KMind local UI shell: search → 3D ego → health HUD.
 */
export function App() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(() => readFocusFromUrl());
  const [depth, setDepth] = useState(2);
  const [graph, setGraph] = useState<EgoGraph | null>(null);
  const [egoIssues, setEgoIssues] = useState<HealthIssue[]>([]);
  const [egoByRule, setEgoByRule] = useState<Record<string, number>>({});
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetchStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    void fetchHealth()
      .then(setHealth)
      .catch(() => {
        /* non-fatal on boot */
      });
  }, []);

  const loadFocus = useCallback(async (id: string, hop: number) => {
    setLoading(true);
    setError(null);
    try {
      const [g, h] = await Promise.all([
        fetchEgo(id, hop),
        fetchEgoHealth(id, hop),
      ]);
      setGraph(g);
      setEgoIssues(h.issues);
      setEgoByRule(h.byRule);
      setFocusId(id);
      writeFocusToUrl(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (focusId) void loadFocus(focusId, depth);
  }, [focusId, depth, loadFocus]);

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
    () => graph?.nodes.find((n) => n.id === graph.focusId) ?? null,
    [graph],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          KMind<span>INSTRUMENT</span>
        </div>
        <div className="search-shell">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => hits.length > 0 && setShowHits(true)}
            onBlur={() => window.setTimeout(() => setShowHits(false), 150)}
            placeholder="搜索知识资产，选中后进入 3D 邻域…"
            aria-label="搜索知识资产"
          />
          {showHits && hits.length > 0 && (
            <div className="results" role="listbox">
              {hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="result"
                  role="option"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQuery(h.title);
                    setShowHits(false);
                    setFocusId(h.id);
                  }}
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
        <div className="meta-chip">
          <div className="chip">
            assets <strong>{status?.assetCount ?? '—'}</strong>
          </div>
          <div className="chip">
            health <strong>{health?.issueCount ?? '—'}</strong>
          </div>
        </div>
      </header>

      <div className="stage">
        {graph ? (
          <GraphView
            graph={graph}
            onSelect={(id) => {
              setFocusId(id);
            }}
          />
        ) : (
          <div className="empty">
            <div>
              <h1>定位一个知识焦点</h1>
              <p>
                从顶部搜索进入 ego 邻域。跳数壳沿径向分层；右侧 HUD
                显示与当前焦点相关的健康信号。
              </p>
            </div>
          </div>
        )}
      </div>

      <aside className="hud" aria-label="健康与焦点面板">
        {!graph && health && (
          <section className="panel">
            <h2>Vault health</h2>
            <div className="summary-grid">
              <div>
                issues
                <strong>{health.issueCount}</strong>
              </div>
              <div>
                rules
                <strong>{Object.keys(health.byRule).length}</strong>
              </div>
            </div>
            <div className="kv" style={{ marginTop: '0.6rem' }}>
              <span>checked</span>
              <b>{new Date(health.checkedAt).toLocaleString()}</b>
            </div>
          </section>
        )}

        {graph && (
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
              <div className="summary-grid">
                <div>
                  related issues
                  <strong>{egoIssues.length}</strong>
                </div>
                <div>
                  top rule
                  <strong>
                    {Object.entries(egoByRule).sort((a, b) => b[1] - a[1])[0]?.[0] ??
                      '—'}
                  </strong>
                </div>
              </div>
              <ul className="issue-list">
                {egoIssues.length === 0 && (
                  <li style={{ borderTop: 'none', color: 'var(--muted)' }}>
                    当前邻域内无健康告警。
                  </li>
                )}
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
                        onClick={() => setFocusId(issue.assetId!)}
                      >
                        → {issue.assetId}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </aside>

      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
