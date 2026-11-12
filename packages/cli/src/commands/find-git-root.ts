import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Walk upward from cwd to find a directory containing `.git`.
 */
export async function findGitRoot(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd);
  for (;;) {
    try {
      await fs.access(path.join(dir, '.git'));
      return dir;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
