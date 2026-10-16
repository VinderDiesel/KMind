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
}

export interface EgoLink {
  source: string;
  target: string;
  relationType: string;
}

export interface EgoGraph {
  focusId: string;
  depth: number;
  nodeCap: number;
  truncated: boolean;
  totalCandidates: number;
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

/** Fetch ego-scoped health issues. */
export function fetchEgoHealth(
  id: string,
  depth: number,
): Promise<{ focusId: string; issues: HealthIssue[]; byRule: Record<string, number> }> {
  return getJson(
    `/api/ego/${encodeURIComponent(id)}/health?depth=${depth}`,
  );
}

/** Vault-wide health summary. */
export function fetchHealth(): Promise<HealthSummary> {
  return getJson('/api/health');
}

/** Vault status. */
export function fetchStatus(): Promise<VaultStatus> {
  return getJson('/api/status');
}

/** Asset detail. */
export function fetchAsset(id: string): Promise<Record<string, unknown>> {
  return getJson(`/api/assets/${encodeURIComponent(id)}`);
}
