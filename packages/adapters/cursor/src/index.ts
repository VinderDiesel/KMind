import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Adapter, McpConfigTemplate } from '@kmind/core';
import type { SessionMessage, SessionRecord } from '@kmind/shared';
import { SessionRecordSchema } from '@kmind/shared';

/**
 * Cursor IDE adapter.
 */
export class CursorAdapter implements Adapter {
  readonly name = 'cursor';
  readonly version = '1.0.0';

  async detect(): Promise<boolean> {
    const candidates = [
      path.join(os.homedir(), '.cursor'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Cursor'),
    ];
    for (const c of candidates) {
      try {
        await fs.access(c);
        return true;
      } catch {
        /* continue */
      }
    }
    return false;
  }

  async getSessionPaths(): Promise<string[]> {
    const roots = [
      path.join(os.homedir(), '.cursor', 'projects'),
      path.join(os.homedir(), '.cursor', 'chats'),
    ];
    const out: string[] = [];
    for (const root of roots) {
      out.push(...(await walkExt(root, ['.jsonl', '.json'])));
    }
    return out;
  }

  async parseSession(sessionPath: string): Promise<SessionRecord> {
    const raw = await fs.readFile(sessionPath, 'utf8');
    const messages: SessionMessage[] = [];
    if (sessionPath.endsWith('.jsonl')) {
      for (const line of raw.split('\n').filter(Boolean)) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          messages.push(normalizeMessage(obj));
        } catch {
          /* skip */
        }
      }
    } else {
      try {
        const data = JSON.parse(raw) as { messages?: Record<string, unknown>[] };
        for (const m of data.messages ?? []) messages.push(normalizeMessage(m));
      } catch {
        messages.push({
          role: 'user',
          content: raw.slice(0, 2000),
          timestamp: new Date().toISOString(),
        });
      }
    }
    return SessionRecordSchema.parse({
      terminal: 'cursor',
      sessionId: path.basename(sessionPath, path.extname(sessionPath)),
      startedAt: messages[0]?.timestamp ?? new Date().toISOString(),
      messages,
      metadata: { path: sessionPath },
    });
  }

  getMcpConfig(): McpConfigTemplate {
    return {
      targetPath: path.join(os.homedir(), '.cursor', 'mcp.json'),
      content: {
        mcpServers: {
          kmind: { command: 'kmind', args: ['mcp-serve'] },
        },
      },
    };
  }
}

export default CursorAdapter;

function normalizeMessage(obj: Record<string, unknown>): SessionMessage {
  return {
    role: (obj.role as SessionMessage['role']) ?? 'assistant',
    content: String(obj.content ?? obj.text ?? ''),
    timestamp: String(obj.timestamp ?? new Date().toISOString()),
    toolName: obj.toolName as string | undefined,
    toolInput: obj.toolInput,
    toolOutput: obj.toolOutput,
  };
}

async function walkExt(root: string, exts: string[]): Promise<string[]> {
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
      else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
    }
  }
  await walk(root);
  return out;
}
