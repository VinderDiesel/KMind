import { createQueryEngine } from '@kmind/core';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Build ADR-002 Context Pack (structured recall for Agents).
 */
export async function cmdPack(
  ctx: AppContext,
  options: {
    id?: string;
    query?: string;
    project?: string;
    type?: string;
    depth?: number;
    neighborCap?: number;
  },
): Promise<void> {
  const engine = createQueryEngine(ctx.vault, ctx.store);
  const pack = await engine.pack({
    id: options.id,
    query: options.query,
    project: options.project,
    type: options.type as never,
    depth: options.depth,
    neighborCap: options.neighborCap,
  });
  if (ctx.json) {
    success(pack, true);
    return;
  }
  if (!pack.focus) {
    process.stdout.write(`No focus.\n${pack.hints.join('\n')}\n`);
    return;
  }
  process.stdout.write(
    `Pack v${pack.version} focus=${pack.focus.id} ${pack.focus.title} (${pack.focus.type})\n`,
  );
  process.stdout.write(
    `  anchors=${pack.codeAnchors.length} neighbors=${pack.neighborhood?.nodes.length ?? 0} related=${pack.related.length} alts=${pack.alternatives.length}\n`,
  );
  if (pack.problemStatus) {
    process.stdout.write(
      `  problemStatus=${pack.problemStatus.status} — ${pack.problemStatus.summary}\n`,
    );
  }
  for (const h of pack.hints) {
    process.stdout.write(`  hint: ${h}\n`);
  }
  process.stdout.write('\n--- focus excerpt ---\n');
  process.stdout.write(`${pack.focus.bodyExcerpt}\n`);
}
