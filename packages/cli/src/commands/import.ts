import { Importer, type ImportConflictPolicy } from '@kmind/core';
import { KMindError } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

export interface CmdImportOptions {
  input: string;
  merge?: boolean;
  conflict?: string;
  format?: string;
}

/**
 * Import vault from tar.gz or git-friendly directory.
 */
export async function cmdImport(
  ctx: AppContext,
  options: CmdImportOptions,
): Promise<void> {
  const importer = new Importer(ctx.vault);
  const conflict = parseConflict(options.conflict);
  const format = options.format ?? detectFormat(options.input);
  const importOpts = { merge: options.merge, conflict };

  const result =
    format === 'git'
      ? await importer.importFromDirectory(options.input, importOpts)
      : await importer.importFromTarGz(options.input, importOpts);

  success(
    {
      imported: true,
      input: options.input,
      format,
      merge: options.merge ?? false,
      conflict,
      result,
    },
    ctx.json,
  );
}

function parseConflict(raw: string | undefined): ImportConflictPolicy {
  const v = (raw ?? 'skip').trim();
  if (v === 'skip' || v === 'overwrite' || v === 'rename') return v;
  throw new KMindError(`Invalid --conflict: ${raw}`, {
    category: 'CONFIG_ERROR',
    severity: 'medium',
    retryable: false,
    suggestion: 'Use skip, overwrite, or rename',
  });
}

function detectFormat(input: string): 'tar.gz' | 'git' {
  if (input.endsWith('.tar.gz') || input.endsWith('.tgz')) return 'tar.gz';
  return 'git';
}
