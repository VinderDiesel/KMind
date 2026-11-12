import type { KnowledgeAsset } from '@kmind/shared';
import { KnowledgeAssetIdPattern, KMindError } from '@kmind/shared';
import type { MarkdownStore } from '../storage/markdown-store.js';
import type { SqliteStore } from '../storage/sqlite-store.js';

export type RetireAction = 'list' | 'deprecate' | 'supersede' | 'refresh';

export interface ExpiredAssetBrief {
  id: string;
  title: string;
  project: string;
  type: string;
  status: string;
  expiresAt: string;
}

export interface RetireExpiredResult {
  action: RetireAction;
  dryRun: boolean;
  matched: ExpiredAssetBrief[];
  updated: string[];
  message: string;
}

/**
 * List assets with expiresAt in the past (non-deprecated).
 */
export function listExpiredAssets(
  assets: KnowledgeAsset[],
  options: { project?: string; now?: Date } = {},
): ExpiredAssetBrief[] {
  const nowMs = (options.now ?? new Date()).getTime();
  const project = options.project?.trim();
  const out: ExpiredAssetBrief[] = [];
  for (const a of assets) {
    if (a.status === 'deprecated') continue;
    if (project && a.project !== project) continue;
    if (!a.expiresAt) continue;
    const exp = Date.parse(a.expiresAt);
    if (!Number.isFinite(exp) || exp >= nowMs) continue;
    out.push({
      id: a.id,
      title: a.title,
      project: a.project,
      type: a.type,
      status: a.status,
      expiresAt: a.expiresAt,
    });
  }
  return out.sort((x, y) => x.expiresAt.localeCompare(y.expiresAt));
}

export interface RetireExpiredOptions {
  store: SqliteStore;
  markdown: MarkdownStore;
  assets: KnowledgeAsset[];
  action: RetireAction;
  /** Target asset id (deprecate / supersede / refresh). */
  id?: string;
  /** Replacement asset id when action=supersede. */
  by?: string;
  /** New expiresAt ISO when action=refresh; omit/null clears expiry. */
  expiresAt?: string | null;
  project?: string;
  dryRun?: boolean;
  now?: Date;
}

/**
 * Expire-card retirement workflow (P0 hygiene closed loop).
 * - list: report expired
 * - deprecate: status=deprecated (drops out of coverage scope)
 * - supersede: deprecate old + link new --by supersedes old
 * - refresh: clear or reset expiresAt on still-valid card
 */
export async function retireExpired(
  options: RetireExpiredOptions,
): Promise<RetireExpiredResult> {
  const dryRun = Boolean(options.dryRun);
  const matched = listExpiredAssets(options.assets, {
    project: options.project,
    now: options.now,
  });

  if (options.action === 'list') {
    return {
      action: 'list',
      dryRun,
      matched,
      updated: [],
      message:
        matched.length === 0
          ? '无过期卡'
          : `发现 ${matched.length} 张过期卡 — 用 deprecate / supersede / refresh 闭环`,
    };
  }

  const id = options.id?.trim();
  if (!id || !KnowledgeAssetIdPattern.test(id)) {
    throw new KMindError('retire-expired: 需要合法 --id', {
      category: 'GRAPH_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: '例如 --id k-2026-11-12-001',
    });
  }

  const target = options.assets.find((a) => a.id === id);
  if (!target) {
    throw new KMindError(`retire-expired: 资产不存在 ${id}`, {
      category: 'GRAPH_ERROR',
      severity: 'medium',
      retryable: false,
      suggestion: '先 kmind search / kmind_get 确认 id',
    });
  }

  if (options.action === 'deprecate') {
    return applyDeprecate(options, target, dryRun);
  }
  if (options.action === 'supersede') {
    return applySupersede(options, target, dryRun);
  }
  if (options.action === 'refresh') {
    return applyRefresh(options, target, dryRun);
  }

  throw new KMindError(`retire-expired: 未知 action ${options.action}`, {
    category: 'GRAPH_ERROR',
    severity: 'medium',
    retryable: false,
    suggestion: 'action 取 list | deprecate | supersede | refresh | deprecate-all',
  });
}

/**
 * Batch-deprecate all expired assets in a project.
 */
export async function deprecateAllExpired(
  options: Omit<RetireExpiredOptions, 'action' | 'id' | 'by'> & {
    project: string;
  },
): Promise<RetireExpiredResult> {
  const project = options.project.trim();
  if (!project || project === 'global') {
    throw new KMindError('deprecate-all: 必须传明确 project', {
      category: 'GRAPH_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: '例如 --project meta-brain',
    });
  }
  const matched = listExpiredAssets(options.assets, {
    project,
    now: options.now,
  });
  const dryRun = Boolean(options.dryRun);
  const updated: string[] = [];
  if (!dryRun) {
    for (const brief of matched) {
      const asset = options.assets.find((a) => a.id === brief.id);
      if (!asset) continue;
      await persistAsset(options, {
        ...asset,
        status: 'deprecated',
        expiresAt: null,
      });
      updated.push(asset.id);
    }
  }
  return {
    action: 'deprecate',
    dryRun,
    matched,
    updated: dryRun ? matched.map((m) => m.id) : updated,
    message: dryRun
      ? `dry-run：将 deprecate ${matched.length} 张过期卡（project=${project}）`
      : `已 deprecate ${updated.length} 张过期卡（project=${project}）`,
  };
}

async function applyDeprecate(
  options: RetireExpiredOptions,
  target: KnowledgeAsset,
  dryRun: boolean,
): Promise<RetireExpiredResult> {
  const brief = toBrief(target);
  if (!dryRun) {
    await persistAsset(options, {
      ...target,
      status: 'deprecated',
      expiresAt: null,
    });
  }
  return {
    action: 'deprecate',
    dryRun,
    matched: [brief],
    updated: [target.id],
    message: dryRun
      ? `dry-run：将 deprecate ${target.id}`
      : `已 deprecate ${target.id}（不再计入 coverage）`,
  };
}

async function applySupersede(
  options: RetireExpiredOptions,
  oldAsset: KnowledgeAsset,
  dryRun: boolean,
): Promise<RetireExpiredResult> {
  const by = options.by?.trim();
  if (!by || !KnowledgeAssetIdPattern.test(by)) {
    throw new KMindError('supersede: 需要合法 --by <新卡id>', {
      category: 'GRAPH_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: '先 capture 新卡，再 kmind expiry supersede --id 旧 --by 新',
    });
  }
  if (by === oldAsset.id) {
    throw new KMindError('supersede: --by 不能与 --id 相同', {
      category: 'GRAPH_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: '--by 传新卡 id，--id 传被替换的旧卡 id',
    });
  }
  const replacement = options.assets.find((a) => a.id === by);
  if (!replacement) {
    throw new KMindError(`supersede: 新卡不存在 ${by}`, {
      category: 'GRAPH_ERROR',
      severity: 'medium',
      retryable: false,
      suggestion: '确认新卡已 capture 入库',
    });
  }

  const links = [...(replacement.links ?? [])];
  if (!links.some((l) => l.id === oldAsset.id && l.relation === 'supersedes')) {
    links.push({ id: oldAsset.id, relation: 'supersedes' });
  }
  const related = [...new Set([...(replacement.related ?? []), oldAsset.id])];

  if (!dryRun) {
    await persistAsset(options, {
      ...oldAsset,
      status: 'deprecated',
      expiresAt: null,
    });
    await persistAsset(options, {
      ...replacement,
      links,
      related,
    });
  }

  return {
    action: 'supersede',
    dryRun,
    matched: [toBrief(oldAsset)],
    updated: [oldAsset.id, replacement.id],
    message: dryRun
      ? `dry-run：${by} supersedes ${oldAsset.id}，并 deprecate 旧卡`
      : `已让 ${by} supersedes ${oldAsset.id}，旧卡已 deprecate`,
  };
}

async function applyRefresh(
  options: RetireExpiredOptions,
  target: KnowledgeAsset,
  dryRun: boolean,
): Promise<RetireExpiredResult> {
  let nextExpires: string | null = null;
  if (options.expiresAt === undefined) {
    nextExpires = null;
  } else if (options.expiresAt === null || options.expiresAt === '') {
    nextExpires = null;
  } else {
    const parsed = Date.parse(options.expiresAt);
    if (!Number.isFinite(parsed)) {
      throw new KMindError('refresh: --expires-at 必须是 ISO datetime', {
        category: 'GRAPH_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion: '例如 --expires-at 2027-01-01T00:00:00.000Z，或省略以清除过期',
      });
    }
    nextExpires = new Date(parsed).toISOString();
  }

  if (!dryRun) {
    await persistAsset(options, {
      ...target,
      expiresAt: nextExpires,
    });
  }

  return {
    action: 'refresh',
    dryRun,
    matched: [toBrief(target)],
    updated: [target.id],
    message: dryRun
      ? `dry-run：将 refresh ${target.id} expiresAt=${nextExpires ?? 'null'}`
      : `已 refresh ${target.id} expiresAt=${nextExpires ?? 'null'}`,
  };
}

async function persistAsset(
  options: Pick<RetireExpiredOptions, 'store' | 'markdown'>,
  asset: KnowledgeAsset,
): Promise<void> {
  await options.markdown.write(asset);
  await options.store.upsertAsset(asset);
}

function toBrief(a: KnowledgeAsset): ExpiredAssetBrief {
  return {
    id: a.id,
    title: a.title,
    project: a.project,
    type: a.type,
    status: a.status,
    expiresAt: a.expiresAt ?? '',
  };
}
