import path from 'node:path';
import { BlobStore, createPipeline } from '@kmind/core';
import { KnowledgeTypeEnum } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Manually capture knowledge content into raw/ then compile.
 */
export async function cmdCapture(
  ctx: AppContext,
  content: string,
  options: { type?: string; title?: string; project?: string },
): Promise<void> {
  const blob = new BlobStore(ctx.vault.rawDir);
  const day = new Date().toISOString().slice(0, 10);
  const title = (options.title ?? content.split('\n')[0] ?? 'untitled')
    .replace(/^#\s*/, '')
    .trim()
    .slice(0, 200);
  const typeParse = KnowledgeTypeEnum.safeParse(options.type ?? 'best_practice');
  const type = typeParse.success ? typeParse.data : 'best_practice';
  const project = options.project ?? 'global';
  const relativePath = path.join('manual', `${day}-${Date.now()}.jsonl`);
  await blob.writeRaw(
    relativePath,
    `${JSON.stringify({
      role: 'user',
      title,
      type,
      project,
      content,
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
  success({ relativePath, title, type, compile: result }, ctx.json);
}
