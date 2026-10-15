import type { AppContext } from '../context.js';
import { createPipeline } from '@kmind/core';
import { success } from '../exit.js';

/**
 * Lifecycle hook entry — triggers incremental compile.
 */
export async function cmdHook(ctx: AppContext, event: string): Promise<void> {
  const pipeline = createPipeline(ctx.vault, {
    sqlite: ctx.store,
    registry: ctx.registry,
    evolver: ctx.evolver,
    adapters: ctx.adapters,
  });
  const result = await pipeline.run({ incremental: true });
  success({ event, compile: result }, ctx.json);
}
