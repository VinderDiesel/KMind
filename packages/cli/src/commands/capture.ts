import path from 'node:path';
import { BlobStore, createPipeline } from '@kmind/core';
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
  const title = options.title ?? content.slice(0, 80);
  const relativePath = path.join('manual', `${day}-${Date.now()}.md`);
  await blob.writeRaw(
    relativePath,
    `${JSON.stringify({
      role: 'user',
      content: `# ${title}\n\n${content}\n\ntype: ${options.type ?? 'best_practice'}`,
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  const pipeline = createPipeline(ctx.vault, {
    sqlite: ctx.store,
    registry: ctx.registry,
    evolver: ctx.evolver,
  });
  const result = await pipeline.run({
    project: options.project ?? 'global',
    force: true,
    incremental: false,
  });
  success({ relativePath, compile: result }, ctx.json);
}
