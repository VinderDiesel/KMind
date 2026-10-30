export interface SearchHit {
  id: string;
  title: string;
  type: string;
  project: string;
  score: number;
  matchedBy: string[];
}

export interface EgoNode {
  id: string;
  title: string;
  type: string;
  hop: number;
  project: string;
  status: string;
  ontologyClass: string;
  hasHealthIssue: boolean;
  hasCodeAnchors?: boolean;
  codeAnchorCount?: number;
}

export interface CodeAnchor {
  file: string;
  symbol?: string;
  kind?: string;
  line?: number;
  projectPath?: string;
  confidence?: number;
}

export interface AssetDetail {
  id: string;
  title: string;
  type: string;
  project: string;
  body?: string;
  related?: string[];
  links?: Array<{ id: string; relation: string }>;
  metadata?: { codeAnchors?: CodeAnchor[]; [k: string]: unknown };
}

export interface EgoLink {
  source: string;
  target: string;
  relationType: string;
}

export interface EgoGraph {
  focusId?: string;
  mode?: 'global' | 'ego';
  depth?: number;
  nodeCap: number;
  truncated: boolean;
  totalCandidates: number;
  project?: string;
  types?: string[];
  nodes: EgoNode[];
  links: EgoLink[];
}

export interface HealthIssue {
  rule: string;
  severity: 'low' | 'medium' | 'high';
  assetId?: string;
  message: string;
}

export interface HealthSummary {
  checkedAt: string;
  issueCount: number;
  totalIssueCount?: number;
  byRule: Record<string, number>;
  issues: HealthIssue[];
}

export interface VaultStatus {
  vaultPath: string;
  assetCount: number;
  lastCompileAt: string | null;
  compileState: unknown;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Search knowledge assets. */
export function searchAssets(q: string, limit = 12): Promise<{ results: SearchHit[] }> {
  return getJson(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

/** List recent assets (no query required). */
export function listAssets(limit = 20): Promise<{ results: SearchHit[] }> {
  return getJson(`/api/assets?limit=${limit}`);
}

/** Fetch ego neighborhood graph. */
export function fetchEgo(
  id: string,
  depth: number,
  cap = 150,
): Promise<EgoGraph> {
  return getJson(
    `/api/ego/${encodeURIComponent(id)}?depth=${depth}&cap=${cap}`,
  );
}

/** Fetch vault-wide graph. */
export function fetchGlobalGraph(options?: {
  cap?: number;
  project?: string;
  type?: string;
}): Promise<EgoGraph> {
  const params = new URLSearchParams();
  if (options?.cap != null) params.set('cap', String(options.cap));
  if (options?.project) params.set('project', options.project);
  if (options?.type) params.set('type', options.type);
  const qs = params.toString();
  return getJson(`/api/graph${qs ? `?${qs}` : ''}`);
}

/** Fetch ego-scoped health issues. */
export function fetchEgoHealth(
  id: string,
  depth: number,
): Promise<{ focusId: string; issues: HealthIssue[]; byRule: Record<string, number> }> {
  return getJson(
    `/api/ego/${encodeURIComponent(id)}/health?depth=${depth}`,
  );
}

/** Vault-wide health summary (optional rule / severity filter). */
export function fetchHealth(options?: {
  rule?: string;
  severity?: string;
}): Promise<HealthSummary> {
  const params = new URLSearchParams();
  if (options?.rule) params.set('rule', options.rule);
  if (options?.severity) params.set('severity', options.severity);
  const qs = params.toString();
  return getJson(`/api/health${qs ? `?${qs}` : ''}`);
}

/** Vault status. */
export function fetchStatus(): Promise<VaultStatus> {
  return getJson('/api/status');
}

/** Asset detail. */
export function fetchAsset(id: string): Promise<AssetDetail> {
  return getJson(`/api/assets/${encodeURIComponent(id)}`);
}

export interface CoverageSummary {
  project: string;
  topic?: string;
  complete: boolean;
  summary: string;
  nextActions: string[];
  issueCount: number;
  hubs: Array<{
    id: string;
    title: string;
    childCount: number;
    shallowCount: number;
  }>;
  shallow: Array<{ id: string; title: string; type: string; chars: number }>;
  duplicateOverviews: Array<{ title: string; ids: string[] }>;
}

/** Project/topic coverage vs catalog-only. */
export function fetchCoverage(options: {
  project: string;
  topic?: string;
  hubId?: string;
}): Promise<CoverageSummary> {
  const params = new URLSearchParams();
  params.set('project', options.project);
  if (options.topic) params.set('topic', options.topic);
  if (options.hubId) params.set('hubId', options.hubId);
  return getJson(`/api/coverage?${params.toString()}`);
}
