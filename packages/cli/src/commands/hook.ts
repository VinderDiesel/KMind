import type { AppContext } from '../context.js';
import { createPipeline } from '@kmind/core';
import { success } from '../exit.js';

/**
 * Lifecycle hook entry — triggers incremental compile.
 * Sessions stay in raw/ unless double-locked (config + KMIND_COMPILE_SESSIONS=1).
 */
export async function cmdHook(ctx: AppContext, event: string): Promise<void> {
  const pipeline = createPipeline(ctx.vault, {
    sqlite: ctx.store,
    registry: ctx.registry,
    evolver: ctx.evolver,
    // Still pass adapters; pipeline honors capture.autoCapture (default false).
    adapters: ctx.adapters,
  });
  const result = await pipeline.run({ incremental: true });
  success({ event, compile: result }, ctx.json);
}
