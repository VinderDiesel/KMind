import { Exporter, type ExportFilter } from '@kmind/core';
import { KnowledgeTypeIdSchema, type KnowledgeType } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';

export interface CmdExportOptions {
  output: string;
  format?: string;
  project?: string | string[];
  type?: string | string[];
  initGit?: boolean;
}

/**
 * Export vault to tar.gz or git directory.
 */
export async function cmdExport(
  ctx: AppContext,
  options: CmdExportOptions,
): Promise<void> {
  const exporter = new Exporter(ctx.vault);
  const filter = buildFilter(options);
  if (options.format === 'git') {
    const manifest = await exporter.exportToGit(options.output, {
      filter,
      initGit: options.initGit === true,
    });
    success(
      {
        exported: true,
        output: options.output,
        format: 'git',
        initGit: options.initGit === true,
        manifest,
      },
      ctx.json,
    );
    return;
  }
  const manifest = await exporter.exportToTarGz(options.output, filter);
  success(
    {
      exported: true,
      output: options.output,
      format: 'tar.gz',
      manifest,
    },
    ctx.json,
  );
}

function buildFilter(options: CmdExportOptions): ExportFilter | undefined {
  const projects = toList(options.project);
  const types = toList(options.type)
    .map((t) => KnowledgeTypeIdSchema.safeParse(t))
    .filter((r): r is { success: true; data: KnowledgeType } => r.success)
    .map((r) => r.data);
  if (!projects.length && !types.length) return undefined;
  return {
    projects: projects.length ? projects : undefined,
    types: types.length ? types : undefined,
  };
}

function toList(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
}
