import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SessionRecord } from '@kmind/shared';
import { SessionRecordSchema } from '@kmind/shared';
import type { Adapter } from '../adapters/types.js';
import type { BlobStore } from '../storage/blob-store.js';
import type { DiagnosticCollector } from '../observability/diagnostic-collector.js';

export interface CapturedRaw {
  relativePath: string;
  absolutePath: string;
  session: SessionRecord;
  hash: string;
}

/**
 * Capture sessions from adapters and/or existing raw files into immutable storage.
 */
export class CaptureStage {
  constructor(
    private readonly rawDir: string,
    private readonly blobStore: BlobStore,
    private readonly diagnostics: DiagnosticCollector,
  ) {}

  /**
   * List existing raw JSONL/MD files under raw/.
   */
  async listRawFiles(): Promise<string[]> {
    const results: string[] = [];
    await walk(this.rawDir, results);
    return results;
  }

  /**
   * Capture from an adapter into raw/sessions/YYYY-MM-DD/.
   */
  async captureFromAdapter(adapter: Adapter): Promise<CapturedRaw[]> {
    const captured: CapturedRaw[] = [];
    let paths: string[] = [];
    try {
      paths = await adapter.getSessionPaths();
    } catch (cause) {
      this.diagnostics.add({
        category: 'ADAPTER_ERROR',
        severity: 'medium',
        message: `Adapter ${adapter.name} getSessionPaths failed`,
        suggestion: 'Check terminal installation paths',
      });
      void cause;
      return captured;
    }

    for (const sessionPath of paths) {
      try {
        const session = await adapter.parseSession(sessionPath);
        const parsed = SessionRecordSchema.parse(session);
        const day = parsed.startedAt.slice(0, 10);
        const relativePath = path.join(
          'sessions',
          day,
          `${adapter.name}-${parsed.sessionId}.jsonl`,
        );
        const content = parsed.messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
        const abs = await this.blobStore.writeRaw(relativePath, content);
        captured.push({
          relativePath,
          absolutePath: abs,
          session: parsed,
          hash: this.blobStore.hash(content),
        });
      } catch (err) {
        this.diagnostics.add({
          category: 'CAPTURE_ERROR',
          severity: 'low',
          message: `Failed to capture ${sessionPath}: ${String(err)}`,
          path: sessionPath,
          suggestion: 'Skip and continue; fix session format if needed',
        });
      }
    }
    return captured;
  }

  /**
   * Parse a raw JSONL file into SessionRecord-like candidate content.
   */
  async readRawAsCandidate(absPath: string): Promise<{
    title: string;
    content: string;
    relativePath: string;
  }> {
    const content = await fs.readFile(absPath, 'utf8');
    const relativePath = path.relative(this.rawDir, absPath);
    const lines = content
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as { content?: string; role?: string };
        } catch {
          return { content: l };
        }
      });
    const text = lines.map((l) => l.content ?? '').join('\n');
    const title =
      lines.find((l) => l.role === 'user')?.content?.slice(0, 80) ??
      path.basename(absPath);
    return { title, content: text, relativePath };
  }
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
}
