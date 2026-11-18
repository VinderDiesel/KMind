import path from 'node:path';
import {
  BlobStore,
  commitCaptureProposal,
  createCaptureProposal,
  createPipeline,
  inferCodeRootFromVault,
  loadCaptureProposal,
  loadOntology,
  markBootstrapProgressTask,
  OntologyRegistry,
  sanitizeTitle,
} from '@kmind/core';
import {
  KnowledgeTypeIdSchema,
  KMindError,
  type CaptureProposalFields,
} from '@kmind/shared';
import type { AppContext } from '../context.js';
import { fail, success } from '../exit.js';
import {
  parseAnchorsOption,
  parseLinksOption,
  parseRelatedOption,
} from './capture.js';

/**
 * Stage a capture proposal under audit/proposals (no knowledge write).
 */
export async function cmdCapturePropose(
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
    bootstrapTask?: string;
  },
): Promise<void> {
  const project = (options.project ?? '').trim();
  if (!project || project === 'global') {
    fail(
      new KMindError('capture propose: 必须传 --project', {
        category: 'CAPTURE_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion: '--project <name>',
      }),
      ctx.json,
    );
  }
  const typeParse = KnowledgeTypeIdSchema.safeParse(
    options.type ?? 'best_practice',
  );
  const anchors = parseAnchorsOption(options.anchors);
  const related = parseRelatedOption(options.related);
  const links = parseLinksOption(options.links);
  const fields: CaptureProposalFields = {
    content,
    title: sanitizeTitle(
      options.title ?? content.split('\n')[0] ?? 'untitled',
    ),
    type: typeParse.success ? typeParse.data : 'best_practice',
    project,
    ...(anchors ? { anchors } : {}),
    ...(related ? { related } : {}),
    ...(links ? { links } : {}),
    bootstrapTask: options.bootstrapTask?.trim() || undefined,
  };
  const proposal = await createCaptureProposal(ctx.vault, fields);
  success(
    {
      proposed: true,
      proposalId: proposal.id,
      status: proposal.status,
      anchors: anchors ?? [],
      related: related ?? [],
      links: links ?? [],
    },
    ctx.json,
  );
}

/**
 * Commit a staged proposal (write knowledge via pipeline).
 * Persists anchors/related/links from the proposal into raw/ (parity with MCP).
 */
export async function cmdCaptureCommit(
  ctx: AppContext,
  proposalId: string,
): Promise<void> {
  const id = proposalId.trim();
  if (!(await loadCaptureProposal(ctx.vault, id))) {
    fail(
      new KMindError(`proposal not found: ${id}`, {
        category: 'CAPTURE_ERROR',
        severity: 'medium',
        retryable: true,
        suggestion: 'kmind capture-propose first',
      }),
      ctx.json,
    );
  }
  try {
    let bootstrapMarked: string | undefined;
    const result = await commitCaptureProposal(ctx.vault, id, {
      execute: async (fields) => {
        const blob = new BlobStore(ctx.vault.rawDir);
        const day = new Date().toISOString().slice(0, 10);
        const relativePath = path.join('manual', `${day}-${Date.now()}.jsonl`);
        await blob.writeRaw(
          relativePath,
          `${JSON.stringify({
            role: 'user',
            title: fields.title,
            type: fields.type,
            project: fields.project,
            content: fields.content,
            ...(fields.anchors?.length ? { anchors: fields.anchors } : {}),
            ...(fields.related?.length ? { related: fields.related } : {}),
            ...(fields.links?.length ? { links: fields.links } : {}),
            timestamp: new Date().toISOString(),
          })}\n`,
        );
        const registry = new OntologyRegistry();
        registry.load(await loadOntology(ctx.vault.ontologyDir));
        const pipeline = createPipeline(ctx.vault, {
          sqlite: ctx.store,
          registry,
          assetTypes: ctx.assetTypes,
        });
        const compile = await pipeline.run({
          project: fields.project,
          incremental: true,
          force: false,
        });
        if (compile.created < 1) {
          throw new KMindError('capture commit created 0 assets', {
            category: 'CAPTURE_ERROR',
            severity: 'high',
            retryable: true,
            suggestion:
              'Check quality gate / type / project / related|anchors on proposal',
          });
        }
        const after = await ctx.store.queryAssets({
          project: fields.project,
          limit: 100_000,
        });
        const assetId = after
          .filter((a) => a.title === fields.title)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]?.id;

        const bootstrapTask = fields.bootstrapTask?.trim();
        if (bootstrapTask && assetId) {
          try {
            await markBootstrapProgressTask({
              vault: ctx.vault,
              project: fields.project,
              repoRoot: inferCodeRootFromVault(ctx.vault.root),
              taskId: bootstrapTask,
              status: 'done',
              assetId,
            });
            bootstrapMarked = bootstrapTask;
          } catch {
            /* mark is best-effort — commit success stands */
          }
        }

        return { assetId };
      },
    });
    success(
      {
        committed: true,
        proposalId: result.proposal.id,
        assetId: result.assetId,
        status: result.proposal.status,
        ...(bootstrapMarked ? { bootstrapMarked } : {}),
      },
      ctx.json,
    );
  } catch (err) {
    fail(err, ctx.json);
  }
}
