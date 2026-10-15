import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { KMindError } from '@kmind/shared';

/**
 * Immutable raw blob storage. Writes never overwrite existing content (R-02).
 */
export class BlobStore {
  constructor(private readonly rawDir: string) {}

  /**
   * Append-only write of a raw session JSONL file.
   * If the path already exists with different content, throws.
   */
  async writeRaw(relativePath: string, content: string): Promise<string> {
    const abs = path.join(this.rawDir, relativePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    try {
      const existing = await fs.readFile(abs, 'utf8');
      if (existing !== content) {
        throw new KMindError(`Raw path is immutable: ${relativePath}`, {
          category: 'CAPTURE_ERROR',
          severity: 'high',
          retryable: false,
          suggestion: 'Write to a new session path instead of overwriting',
        });
      }
      return abs;
    } catch (err) {
      if (err instanceof KMindError) throw err;
      await fs.writeFile(abs, content, 'utf8');
      return abs;
    }
  }

  /** Compute SHA-256 of content. */
  hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /** Read raw file if present. */
  async readRaw(relativePath: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.rawDir, relativePath), 'utf8');
    } catch {
      return null;
    }
  }
}
