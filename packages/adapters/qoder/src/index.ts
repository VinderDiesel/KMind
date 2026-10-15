import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Adapter, McpConfigTemplate } from '@kmind/core';
import type { SessionMessage, SessionRecord } from '@kmind/shared';
import { SessionRecordSchema } from '@kmind/shared';

const execFileAsync = promisify(execFile);

/**
 * Qoder terminal adapter.
 */
export class QoderAdapter implements Adapter {
  readonly name = 'qoder';
  readonly version = '1.0.0';

  async detect(): Promise<boolean> {
    try {
      await execFileAsync('which', ['qoder']);
      return true;
    } catch {
      try {
        await fs.access(path.join(os.homedir(), '.qoder'));
        return true;
      } catch {
        return false;
      }
    }
  }

  async getSessionPaths(): Promise<string[]> {
    return walkJsonl(path.join(os.homedir(), '.qoder', 'sessions'));
  }

  async parseSession(sessionPath: string): Promise<SessionRecord> {
    const raw = await fs.readFile(sessionPath, 'utf8');
    const messages: SessionMessage[] = [];
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        messages.push({
          role: (obj.role as SessionMessage['role']) ?? 'user',
          content: String(obj.content ?? ''),
          timestamp: String(obj.timestamp ?? new Date().toISOString()),
          toolName: obj.toolName as string | undefined,
          toolInput: obj.toolInput,
          toolOutput: obj.toolOutput,
        });
      } catch {
        /* skip */
      }
    }
    return SessionRecordSchema.parse({
      terminal: 'qoder',
      sessionId: path.basename(sessionPath, path.extname(sessionPath)),
      startedAt: messages[0]?.timestamp ?? new Date().toISOString(),
      messages,
      metadata: { path: sessionPath },
    });
  }

  getMcpConfig(): McpConfigTemplate {
    return {
      targetPath: path.join(os.homedir(), '.qoder', 'mcp.json'),
      content: {
        mcpServers: {
          kmind: { command: 'kmind', args: ['mcp-serve'] },
        },
      },
    };
  }
}

export default QoderAdapter;

async function walkJsonl(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.jsonl')) out.push(full);
    }
  }
  await walk(root);
  return out;
}
