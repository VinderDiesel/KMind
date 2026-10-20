import path from 'node:path';
import {
  assessCaptureQuality,
  assessOverviewChildrenDepth,
  assessProjectCoverage,
  BlobStore,
  createPipeline,
  isOverviewTitle,
  sanitizeTitle,
} from '@kmind/core';
import {
  AssetLinkSchema,
  CodeAnchorSchema,
  KnowledgeTypeEnum,
  KMindError,
} from '@kmind/shared';
import type { AppContext } from '../context.js';
import { fail, success } from '../exit.js';

/**
 * Manually capture knowledge content into raw/ then compile.
 */
export async function cmdCapture(
  ctx: AppContext,
  content: string,
  options: {
    type?: string;
    title?: string;
    project?: string;
    /** JSON array of { file, symbol?, kind?, line? }. */
    anchors?: string;
    /** Comma-separated related asset ids. */
    related?: string;
    /** JSON array of { id, relation } typed links. */
    links?: string;
  },
): Promise<void> {
  const blob = new BlobStore(ctx.vault.rawDir);
  const day = new Date().toISOString().slice(0, 10);
  const title = sanitizeTitle(
    options.title ?? content.split('\n')[0] ?? 'untitled',
  );
  const typeParse = KnowledgeTypeEnum.safeParse(options.type ?? 'best_practice');
  const type = typeParse.success ? typeParse.data : 'best_practice';
  const project = (options.project ?? '').trim();
  if (!project || project === 'global') {
    fail(
      new KMindError('quality_gate: 必须传明确 --project（禁止缺省/global）', {
        category: 'CAPTURE_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion: '例如 --project ccdp-ontology 或 --project meta-brain',
      }),
      ctx.json,
    );
  }
  const anchors = parseAnchorsOption(options.anchors);
  const related = parseRelatedOption(options.related);
  const links = parseLinksOption(options.links);
  const peers = await ctx.store.queryAssets({ project, limit: 200 });
  const quality = assessCaptureQuality(content, type, {
    title,
    related,
    links,
    incremental: peers.length > 0,
    hubIds: peers
      .filter((a) => /总览|概览|索引|overview/i.test(a.title))
      .map((a) => a.id),
  });
  const gateReasons = [...quality.reasons];
  if (isOverviewTitle(title) && related && related.length > 0) {
    const resolved = new Map(peers.map((p) => [p.id, p] as const));
    for (const id of related) {
      if (!resolved.has(id)) {
        const a = await ctx.store.getAsset(id);
        if (a) resolved.set(id, a);
      }
    }
    const childGate = assessOverviewChildrenDepth(related, (id) =>
      resolved.get(id),
    );
    gateReasons.push(...childGate.reasons);
  }
  if (gateReasons.length > 0) {
    fail(
      new KMindError(`quality_gate: ${gateReasons.join('；')}`, {
        category: 'CAPTURE_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion:
          '一卡一事；明细写实现+注意+红线+锚点；总览须薄且 related 指向非浅子卡；整理后用 kmind coverage 验收',
      }),
      ctx.json,
    );
  }
  const relativePath = path.join('manual', `${day}-${Date.now()}.jsonl`);
  await blob.writeRaw(
    relativePath,
    `${JSON.stringify({
      role: 'user',
      title,
      type,
      project,
      content,
      ...(anchors ? { anchors } : {}),
      ...(related ? { related } : {}),
      ...(links ? { links } : {}),
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  const pipeline = createPipeline(ctx.vault, {
    sqlite: ctx.store,
    registry: ctx.registry,
    evolver: ctx.evolver,
  });
  // Incremental: only the new raw file (and changed hashes) compile; ids continue from vault max.
  const result = await pipeline.run({
    project,
    force: false,
    incremental: true,
  });
  const afterAssets = await ctx.store.queryAssets({ project, limit: 100_000 });
  const coverage = assessProjectCoverage(afterAssets, { project });
  success(
    {
      relativePath,
      title,
      type,
      anchors: anchors ?? [],
      related: related ?? [],
      links: links ?? [],
      compile: result,
      coverage: {
        complete: coverage.complete,
        summary: coverage.summary,
        nextActions: coverage.nextActions,
        issueCount: coverage.issues.length,
      },
      claimCompleteAllowed: coverage.complete,
    },
    ctx.json,
  );
}

function parseLinksOption(raw?: string) {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const out = [];
    for (const item of parsed) {
      const a = AssetLinkSchema.safeParse(item);
      if (a.success) out.push(a.data);
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function parseRelatedOption(raw?: string): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const ids = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^k-\d{4}-\d{2}-\d{2}-\d{3}$/.test(s));
  return ids.length > 0 ? [...new Set(ids)] : undefined;
}

function parseAnchorsOption(raw?: string) {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const out = [];
    for (const item of parsed) {
      const a = CodeAnchorSchema.safeParse(item);
      if (a.success) out.push(a.data);
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}
