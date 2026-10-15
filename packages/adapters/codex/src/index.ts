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
 * OpenAI Codex CLI adapter.
 */
export class CodexAdapter implements Adapter {
  readonly name = 'codex';
  readonly version = '1.0.0';

  async detect(): Promise<boolean> {
    try {
      await execFileAsync('which', ['codex']);
      return true;
    } catch {
      try {
        await fs.access(path.join(os.homedir(), '.codex'));
        return true;
      } catch {
        return false;
      }
    }
  }

  async getSessionPaths(): Promise<string[]> {
    const roots = [
      path.join(os.homedir(), '.codex', 'sessions'),
      path.join(os.homedir(), '.codex', 'history'),
    ];
    const out: string[] = [];
    for (const root of roots) out.push(...(await walkJsonl(root)));
    return out;
  }

  async parseSession(sessionPath: string): Promise<SessionRecord> {
    const raw = await fs.readFile(sessionPath, 'utf8');
    const messages: SessionMessage[] = [];
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        messages.push({
          role: (obj.role as SessionMessage['role']) ?? 'assistant',
          content: String(obj.content ?? obj.text ?? ''),
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
      terminal: 'codex',
      sessionId: path.basename(sessionPath, path.extname(sessionPath)),
      startedAt: messages[0]?.timestamp ?? new Date().toISOString(),
      messages,
      metadata: { path: sessionPath },
    });
  }

  getMcpConfig(): McpConfigTemplate {
    return {
      targetPath: path.join(os.homedir(), '.codex', 'config.toml'),
      content: {
        mcp_servers: {
          kmind: { command: 'kmind', args: ['mcp-serve'] },
        },
      },
    };
  }
}

export default CodexAdapter;

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
      else if (e.name.endsWith('.jsonl') || e.name.endsWith('.json')) out.push(full);
    }
  }
  await walk(root);
  return out;
}
