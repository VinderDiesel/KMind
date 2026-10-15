import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  Adapter,
  LifecycleHookConfig,
  McpConfigTemplate,
} from '@kmind/core';
import type { SessionMessage, SessionRecord } from '@kmind/shared';
import { SessionRecordSchema } from '@kmind/shared';

const execFileAsync = promisify(execFile);

/**
 * Claude Code terminal adapter.
 */
export class ClaudeCodeAdapter implements Adapter {
  readonly name = 'claude-code';
  readonly version = '1.0.0';

  async detect(): Promise<boolean> {
    try {
      await execFileAsync('which', ['claude']);
      return true;
    } catch {
      return false;
    }
  }

  async getSessionPaths(): Promise<string[]> {
    const root = path.join(os.homedir(), '.claude', 'projects');
    return globJsonl(root);
  }

  async parseSession(sessionPath: string): Promise<SessionRecord> {
    const raw = await fs.readFile(sessionPath, 'utf8');
    const messages: SessionMessage[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        messages.push({
          role: (obj.role as SessionMessage['role']) ?? 'assistant',
          content: String(obj.content ?? obj.message ?? ''),
          timestamp: String(obj.timestamp ?? new Date().toISOString()),
          toolName: obj.toolName as string | undefined,
          toolInput: obj.toolInput,
          toolOutput: obj.toolOutput,
        });
      } catch {
        /* skip bad line */
      }
    }
    const sessionId =
      path.basename(sessionPath, path.extname(sessionPath)) || 'unknown';
    return SessionRecordSchema.parse({
      terminal: 'claude-code',
      sessionId,
      startedAt: messages[0]?.timestamp ?? new Date().toISOString(),
      endedAt: messages.at(-1)?.timestamp,
      messages,
      metadata: { path: sessionPath },
    });
  }

  getMcpConfig(): McpConfigTemplate {
    return {
      targetPath: path.join(os.homedir(), '.claude', 'claude_desktop_config.json'),
      content: {
        mcpServers: {
          kmind: { command: 'kmind', args: ['mcp-serve'] },
        },
      },
    };
  }

  getLifecycleHooks(): LifecycleHookConfig[] {
    return [
      { event: 'PostToolUse', command: 'kmind hook post-tool-use' },
      { event: 'Stop', command: 'kmind hook stop' },
    ];
  }
}

export default ClaudeCodeAdapter;

async function globJsonl(root: string): Promise<string[]> {
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
