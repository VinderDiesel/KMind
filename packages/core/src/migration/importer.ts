import { promises as fs } from 'node:fs';
import path from 'node:path';
import { extract } from 'tar';
import type { Vault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';

export interface ImportOptions {
  merge?: boolean;
}

/**
 * Import vault from tar.gz archive.
 */
export class Importer {
  constructor(private readonly vault: Vault) {}

  async importFromTarGz(
    inputPath: string,
    options: ImportOptions = {},
  ): Promise<void> {
    const merge = options.merge ?? false;
    if (!merge) {
      // Wipe knowledge/raw then extract
      await fs.rm(this.vault.knowledgeDir, { recursive: true, force: true });
      await fs.rm(this.vault.rawDir, { recursive: true, force: true });
      await this.vault.init();
    }
    await extract({
      file: inputPath,
      cwd: this.vault.root,
    });
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
