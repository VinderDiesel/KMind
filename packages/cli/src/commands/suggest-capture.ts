import {
  buildCaptureSuggestions,
  sanitizeTitle,
} from '@kmind/core';
import {
  AssetLinkSchema,
  CodeAnchorSchema,
  KnowledgeTypeIdSchema,
  KMindError,
} from '@kmind/shared';
import type { AppContext } from '../context.js';
import { fail, success } from '../exit.js';

/**
 * ADR-002: print capture suggestions without writing (human confirms → capture).
 */
export async function cmdSuggestCapture(
  ctx: AppContext,
  content: string,
  options: {
    type?: string;
    title?: string;
    project?: string;
    anchors?: string;
    related?: string;
    links?: string;
  },
): Promise<void> {
  const project = (options.project ?? '').trim();
  if (!project || project === 'global') {
    fail(
      new KMindError('必须传明确 --project', {
        category: 'CAPTURE_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion: '例如 --project kmind',
      }),
      ctx.json,
    );
  }
  const title = sanitizeTitle(
    options.title ?? content.split('\n')[0] ?? 'untitled',
  );
  const typeParse = KnowledgeTypeIdSchema.safeParse(options.type);
  const related = options.related
    ? options.related
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const links = options.links
    ? parseJsonArray(options.links)
        .map((item) => AssetLinkSchema.safeParse(item))
        .filter((r) => r.success)
        .map((r) => r.data)
    : undefined;
  const anchors = options.anchors
    ? parseJsonArray(options.anchors)
        .map((item) => CodeAnchorSchema.safeParse(item))
        .filter((r) => r.success)
        .map((r) => r.data)
    : undefined;

  const report = await buildCaptureSuggestions(
    {
      content,
      title,
      project,
      type: typeParse.success ? typeParse.data : undefined,
      related,
      links,
      anchors,
    },
    { store: ctx.store, assetTypes: ctx.assetTypes },
  );

  if (ctx.json) {
    success(report, true);
    return;
  }
  process.stdout.write(
    `Suggest v${report.version} type=${report.type} project=${report.project}\n`,
  );
  process.stdout.write(`title: ${report.title}\n`);
  for (const s of report.suggestions) {
    process.stdout.write(
      `- [${s.kind} ${s.confidence.toFixed(2)}] ${s.id}: ${s.message}\n`,
    );
  }
  if (report.proposedCapture) {
    process.stdout.write('\nproposedCapture (merge into capture if accepted):\n');
    process.stdout.write(`${JSON.stringify(report.proposedCapture, null, 2)}\n`);
  }
  for (const h of report.hints) {
    process.stdout.write(`hint: ${h}\n`);
  }
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
