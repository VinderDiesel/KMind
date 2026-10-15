import { Importer } from '@kmind/core';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Import vault from tar.gz.
 */
export async function cmdImport(
  ctx: AppContext,
  options: { input: string; merge?: boolean },
): Promise<void> {
  const importer = new Importer(ctx.vault);
  await importer.importFromTarGz(options.input, { merge: options.merge });
  success({ imported: true, input: options.input }, ctx.json);
}
