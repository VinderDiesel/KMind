import { Exporter } from '@kmind/core';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

/**
 * Export vault to tar.gz or git directory.
 */
export async function cmdExport(
  ctx: AppContext,
  options: { output: string; format?: string },
): Promise<void> {
  const exporter = new Exporter(ctx.vault);
  if (options.format === 'git') {
    await exporter.exportToGit(options.output);
  } else {
    await exporter.exportToTarGz(options.output);
  }
  success({ exported: true, output: options.output }, ctx.json);
}
