import { promises as fs } from 'node:fs';
import path from 'node:path';
import { create } from 'tar';
import type { Vault } from '../storage/vault.js';

/**
 * Export vault to tar.gz or a git-friendly directory copy.
 */
export class Exporter {
  constructor(private readonly vault: Vault) {}

  /** Export entire vault root to a gzipped tar archive. */
  async exportToTarGz(outputPath: string): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await create(
      {
        gzip: true,
        file: outputPath,
        cwd: this.vault.root,
      },
      ['.'],
    );
  }

  /** Copy knowledge/ontology/raw/config into a directory for git versioning. */
  async exportToGit(repoPath: string): Promise<void> {
    await fs.mkdir(repoPath, { recursive: true });
    await copyDir(this.vault.knowledgeDir, path.join(repoPath, 'knowledge'));
    await copyDir(this.vault.ontologyDir, path.join(repoPath, 'ontology'));
    await copyDir(this.vault.rawDir, path.join(repoPath, 'raw'));
    const config = await fs.readFile(this.vault.configPath, 'utf8');
    await fs.writeFile(path.join(repoPath, 'config.yaml'), config, 'utf8');
  }
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
