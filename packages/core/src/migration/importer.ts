import { promises as fs } from 'node:fs';
import path from 'node:path';
import { extract } from 'tar';
import { KMindError } from '@kmind/shared';
import type { Vault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { MarkdownStore } from '../storage/markdown-store.js';

export type ImportConflictPolicy = 'skip' | 'overwrite' | 'rename';

export interface ImportOptions {
  merge?: boolean;
  /** When merge=true and an asset id already exists. Default: skip. */
  conflict?: ImportConflictPolicy;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  overwritten: number;
  renamed: number;
  warnings: string[];
}

/**
 * Import vault from tar.gz archive or a git-friendly directory.
 */
export class Importer {
  constructor(private readonly vault: Vault) {}

  async importFromTarGz(
    inputPath: string,
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    const merge = options.merge ?? false;
    if (!merge) {
      await fs.rm(this.vault.knowledgeDir, { recursive: true, force: true });
      await fs.rm(this.vault.rawDir, { recursive: true, force: true });
      await this.vault.init();
      await extract({
        file: inputPath,
        cwd: this.vault.root,
      });
      await this.rebuildIndex();
      const md = new MarkdownStore(this.vault.knowledgeDir);
      const files = await md.list();
      return {
        imported: files.length,
        skipped: 0,
        overwritten: 0,
        renamed: 0,
        warnings: [],
      };
    }

    const staging = await fs.mkdtemp(
      path.join(this.vault.root, '.kmind-import-'),
    );
    try {
      await extract({
        file: inputPath,
        cwd: staging,
      });
      return await this.mergeFromDirectory(staging, options);
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * Import from a git-friendly export directory (knowledge/ontology/raw/config).
   */
  async importFromDirectory(
    dirPath: string,
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    const merge = options.merge ?? false;
    const srcKnowledge = path.join(dirPath, 'knowledge');
    try {
      await fs.access(srcKnowledge);
    } catch {
      throw new KMindError(`Import directory missing knowledge/: ${dirPath}`, {
        category: 'CONFIG_ERROR',
        severity: 'high',
        retryable: false,
        suggestion: 'Pass a path produced by kmind export --format git',
      });
    }

    if (!merge) {
      await fs.rm(this.vault.knowledgeDir, { recursive: true, force: true });
      await fs.rm(this.vault.rawDir, { recursive: true, force: true });
      await this.vault.init();
      await copyDir(srcKnowledge, this.vault.knowledgeDir);
      await copyDirIfExists(
        path.join(dirPath, 'raw'),
        this.vault.rawDir,
      );
      await copyDirIfExists(
        path.join(dirPath, 'ontology'),
        this.vault.ontologyDir,
      );
      try {
        const config = await fs.readFile(
          path.join(dirPath, 'config.yaml'),
          'utf8',
        );
        await fs.writeFile(this.vault.configPath, config, 'utf8');
      } catch {
        /* optional */
      }
      await this.rebuildIndex();
      const md = new MarkdownStore(this.vault.knowledgeDir);
      return {
        imported: (await md.list()).length,
        skipped: 0,
        overwritten: 0,
        renamed: 0,
        warnings: [],
      };
    }

    return this.mergeFromDirectory(dirPath, options);
  }

  private async mergeFromDirectory(
    dirPath: string,
    options: ImportOptions,
  ): Promise<ImportResult> {
    const conflict: ImportConflictPolicy = options.conflict ?? 'skip';
    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      overwritten: 0,
      renamed: 0,
      warnings: [],
    };

    const srcMd = new MarkdownStore(path.join(dirPath, 'knowledge'));
    const destMd = new MarkdownStore(this.vault.knowledgeDir);
    const srcFiles = await srcMd.list();
    const existingIds = new Set<string>();
    for (const f of await destMd.list()) {
      try {
        const a = await destMd.readFile(f);
        existingIds.add(a.id);
      } catch {
        /* ignore */
      }
    }

    for (const filePath of srcFiles) {
      let asset;
      try {
        asset = await srcMd.readFile(filePath);
      } catch {
        result.warnings.push(`skip unreadable: ${path.basename(filePath)}`);
        continue;
      }

      const exists = existingIds.has(asset.id);
      if (!exists) {
        await destMd.write(asset);
        existingIds.add(asset.id);
        result.imported += 1;
        await copyRawForAsset(dirPath, this.vault, asset.source?.rawPath);
        continue;
      }

      if (conflict === 'skip') {
        result.skipped += 1;
        continue;
      }
      if (conflict === 'overwrite') {
        await destMd.write(asset);
        result.overwritten += 1;
        await copyRawForAsset(dirPath, this.vault, asset.source?.rawPath);
        continue;
      }

      // rename
      const newId = allocateRenameId(asset.id, existingIds);
      const renamed = { ...asset, id: newId };
      await destMd.write(renamed);
      existingIds.add(newId);
      result.renamed += 1;
      result.imported += 1;
      await copyRawForAsset(dirPath, this.vault, asset.source?.rawPath);
    }

    await copyDirIfExists(
      path.join(dirPath, 'ontology'),
      this.vault.ontologyDir,
    );
    await this.rebuildIndex();
    return result;
  }

  private async rebuildIndex(): Promise<void> {
    const store = new SqliteStore(this.vault.indexPath);
    await store.migrate();
    await store.rebuildFromMarkdown(this.vault.knowledgeDir);
    store.close();
  }
}

/**
 * Ensure parent dirs exist for path.
 */
export async function ensureParent(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function allocateRenameId(originalId: string, existing: Set<string>): string {
  const day = new Date().toISOString().slice(0, 10);
  let n = 1;
  while (n < 10_000) {
    const candidate = `k-${day}-${String(n).padStart(3, '0')}`;
    if (!existing.has(candidate) && candidate !== originalId) {
      return candidate;
    }
    n += 1;
  }
  return `k-${day}-${Date.now()}`;
}

async function copyRawForAsset(
  srcRoot: string,
  vault: Vault,
  rawRel: string | undefined,
): Promise<void> {
  if (!rawRel) return;
  const from = path.join(srcRoot, 'raw', rawRel);
  const to = path.join(vault.rawDir, rawRel);
  try {
    await fs.access(from);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  } catch {
    /* optional */
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
