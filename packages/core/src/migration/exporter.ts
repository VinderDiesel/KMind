import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { create } from 'tar';
import { KMindError, type KnowledgeType } from '@kmind/shared';
import type { Vault } from '../storage/vault.js';
import { MarkdownStore } from '../storage/markdown-store.js';

export const EXPORT_FORMAT_VERSION = 1;

export interface ExportFilter {
  /** Keep only assets whose project is in this list. */
  projects?: string[];
  /** Keep only assets whose type is in this list. */
  types?: KnowledgeType[];
}

export interface ExportManifest {
  formatVersion: number;
  exportedAt: string;
  assetCount: number;
  filters?: {
    projects?: string[];
    types?: string[];
  };
  warnings: string[];
}

export interface ExportToGitOptions {
  /** Run `git init` + initial commit after writing the directory. */
  initGit?: boolean;
  commitMessage?: string;
}

/**
 * Export vault to tar.gz or a git-friendly directory copy.
 */
export class Exporter {
  constructor(private readonly vault: Vault) {}

  /**
   * Export vault to a gzipped tar archive.
   * Excludes rebuildable `index/` DB files; writes `manifest.json`.
   */
  async exportToTarGz(
    outputPath: string,
    filter?: ExportFilter,
  ): Promise<ExportManifest> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const staging = await fs.mkdtemp(
      path.join(path.dirname(outputPath), '.kmind-export-'),
    );
    try {
      const manifest = await this.stageExport(staging, filter);
      await create(
        {
          gzip: true,
          file: outputPath,
          cwd: staging,
        },
        ['.'],
      );
      return manifest;
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * Copy knowledge/ontology/raw/config into a directory for git versioning.
   * Writes `.gitignore` (ignores `index/`) and optional `git init` + commit.
   */
  async exportToGit(
    repoPath: string,
    options: ExportToGitOptions & { filter?: ExportFilter } = {},
  ): Promise<ExportManifest> {
    await fs.mkdir(repoPath, { recursive: true });
    const manifest = await this.stageExport(repoPath, options.filter);
    await fs.writeFile(
      path.join(repoPath, '.gitignore'),
      ['index/', '*.db', '.DS_Store', ''].join('\n'),
      'utf8',
    );
    if (options.initGit) {
      await initGitRepo(
        repoPath,
        options.commitMessage ?? 'kmind export',
      );
    }
    return manifest;
  }

  private async stageExport(
    destRoot: string,
    filter?: ExportFilter,
  ): Promise<ExportManifest> {
    const warnings: string[] = [];
    const md = new MarkdownStore(this.vault.knowledgeDir);
    const files = await md.list();
    const kept: string[] = [];

    const destKnowledge = path.join(destRoot, 'knowledge');
    await fs.mkdir(destKnowledge, { recursive: true });

    for (const filePath of files) {
      let asset;
      try {
        asset = await md.readFile(filePath);
      } catch {
        warnings.push(`skip unreadable: ${path.basename(filePath)}`);
        continue;
      }
      if (filter?.projects?.length && !filter.projects.includes(asset.project)) {
        continue;
      }
      if (filter?.types?.length && !filter.types.includes(asset.type)) {
        continue;
      }
      await fs.copyFile(
        filePath,
        path.join(destKnowledge, path.basename(filePath)),
      );
      kept.push(asset.id);

      const rawRel = asset.source?.rawPath;
      if (rawRel) {
        const rawSrc = path.join(this.vault.rawDir, rawRel);
        try {
          await fs.access(rawSrc);
          const rawDest = path.join(destRoot, 'raw', rawRel);
          await fs.mkdir(path.dirname(rawDest), { recursive: true });
          await fs.copyFile(rawSrc, rawDest);
        } catch {
          warnings.push(`raw missing for ${asset.id}: ${rawRel}`);
        }
      }
    }

    await copyDirIfExists(
      this.vault.ontologyDir,
      path.join(destRoot, 'ontology'),
    );
    try {
      const config = await fs.readFile(this.vault.configPath, 'utf8');
      await fs.writeFile(path.join(destRoot, 'config.yaml'), config, 'utf8');
    } catch {
      warnings.push('config.yaml missing at source');
    }

    // When no filter, also copy remaining raw/ for full fidelity (sessions etc.)
    if (!filter?.projects?.length && !filter?.types?.length) {
      await copyDirIfExists(this.vault.rawDir, path.join(destRoot, 'raw'));
    }

    const manifest: ExportManifest = {
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      assetCount: kept.length,
      filters:
        filter?.projects?.length || filter?.types?.length
          ? {
              projects: filter.projects,
              types: filter.types,
            }
          : undefined,
      warnings,
    };
    await fs.writeFile(
      path.join(destRoot, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    return manifest;
  }
}

async function copyDirIfExists(src: string, dest: string): Promise<void> {
  try {
    await fs.access(src);
  } catch {
    return;
  }
  await copyDir(src, dest);
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  let entries;
  try {
    entries = await fs.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

/**
 * Initialize a git repo in dir and create an initial commit.
 */
export async function initGitRepo(
  repoPath: string,
  commitMessage: string,
): Promise<void> {
  const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (gitCheck.status !== 0) {
    throw new KMindError('git not found on PATH', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: false,
      suggestion: 'Install git or omit --init-git',
    });
  }

  const run = (args: string[]): void => {
    const r = spawnSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      throw new KMindError(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`, {
        category: 'CONFIG_ERROR',
        severity: 'high',
        retryable: false,
        suggestion: 'Check git availability and repo permissions',
      });
    }
  };

  // Empty template avoids writing sample hooks (sandbox-friendly).
  run(['-c', 'init.templateDir=', 'init']);
  run(['config', 'user.email', 'kmind@local']);
  run(['config', 'user.name', 'kmind']);
  run(['add', '-A']);
  run(['commit', '-m', commitMessage]);
}
