import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Adapter, McpConfigTemplate } from '@kmind/core';
import type { SessionMessage, SessionRecord } from '@kmind/shared';
import { SessionRecordSchema } from '@kmind/shared';

const execFileAsync = promisify(execFile);

/** Kiro home directory (honors KIRO_HOME). */
function kiroHome(): string {
  return process.env.KIRO_HOME?.trim() || path.join(os.homedir(), '.kiro');
}

/**
 * Amazon Kiro (IDE + CLI) adapter.
 * Sessions under ~/.kiro/sessions; MCP at ~/.kiro/settings/mcp.json.
 */
export class KiroAdapter implements Adapter {
  readonly name = 'kiro';
  readonly version = '1.0.0';

  async detect(): Promise<boolean> {
    for (const bin of ['kiro', 'kiro-cli']) {
      try {
        await execFileAsync('which', [bin]);
        return true;
      } catch {
        /* continue */
      }
    }
    for (const c of [
      kiroHome(),
      path.join(os.homedir(), 'Library', 'Application Support', 'Kiro'),
      path.join(os.homedir(), '.config', 'Kiro'),
    ]) {
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
    const out: string[] = [];
    await walkSessions(path.join(kiroHome(), 'sessions'), out);
    return out;
  }

  async parseSession(sessionPath: string): Promise<SessionRecord> {
    const raw = await fs.readFile(sessionPath, 'utf8');
    const messages: SessionMessage[] = [];
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const msg = normalizeLine(JSON.parse(line) as Record<string, unknown>);
        if (msg) messages.push(msg);
      } catch {
        /* skip */
      }
    }
    const base = path.basename(sessionPath, path.extname(sessionPath));
    const sessionId =
      base === 'messages' ? path.basename(path.dirname(sessionPath)) : base;
    return SessionRecordSchema.parse({
      terminal: 'kiro',
      sessionId,
      startedAt: messages[0]?.timestamp ?? new Date().toISOString(),
      messages,
      metadata: { path: sessionPath },
    });
  }

  getMcpConfig(): McpConfigTemplate {
    return {
      targetPath: path.join(kiroHome(), 'settings', 'mcp.json'),
      content: {
        mcpServers: {
          kmind: { command: 'kmind', args: ['mcp-serve'] },
        },
      },
    };
  }
}

export default KiroAdapter;

function normalizeLine(obj: Record<string, unknown>): SessionMessage | null {
  if (typeof obj.role === 'string' && (obj.content !== undefined || obj.text !== undefined)) {
    return toMessage(obj.role as SessionMessage['role'], String(obj.content ?? obj.text ?? ''), obj.timestamp, obj);
  }
  // CLI: { kind, data: { content, meta } }
  if (typeof obj.kind === 'string' && obj.data && typeof obj.data === 'object') {
    const data = obj.data as Record<string, unknown>;
    const role =
      obj.kind === 'Prompt' || obj.kind === 'ToolResults'
        ? 'user'
        : obj.kind === 'AssistantMessage' || obj.kind === 'ToolUse'
          ? 'assistant'
          : null;
    if (!role) return null;
    const meta = data.meta as Record<string, unknown> | undefined;
    return toMessage(role, extractContent(data.content ?? data), meta?.timestamp, data);
  }
  // IDE: { timestamp, payload: { type, content, ... } }
  const payload = (obj.payload ?? obj) as Record<string, unknown>;
  const type = String(payload.type ?? '');
  const ts = obj.timestamp ?? payload.timestamp;
  if (type === 'user' || type === 'Prompt') {
    return toMessage('user', extractContent(payload.content), ts, payload);
  }
  if (type === 'assistant') {
    if (payload.operationType === 'Reasoning') return null;
    return toMessage('assistant', extractContent(payload.content), ts, payload);
  }
  if (type === 'tool_call' && (payload.status === 'completed' || payload.status === 'failed')) {
    return toMessage('tool', extractContent(payload.args ?? payload.title), ts, {
      toolName: payload.toolName,
      toolInput: payload.args,
    });
  }
  if (type === 'tool_result') {
    return toMessage('tool', extractContent(payload.content), ts, {
      toolName: payload.toolName,
      toolOutput: payload.content,
    });
  }
  return null;
}

function extractContent(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          return String(p.data ?? p.text ?? p.content ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function toMessage(
  role: SessionMessage['role'],
  content: string,
  timestamp: unknown,
  extra: Record<string, unknown>,
): SessionMessage {
  let ts: string;
  if (typeof timestamp === 'number') {
    ts = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000).toISOString();
  } else if (typeof timestamp === 'string' && timestamp.length > 0) {
    const d = new Date(timestamp);
    ts = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } else {
    ts = new Date().toISOString();
  }
  return {
    role,
    content,
    timestamp: ts,
    toolName: extra.toolName as string | undefined,
    toolInput: extra.toolInput ?? extra.args,
    toolOutput: extra.toolOutput,
  };
}

async function walkSessions(root: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'snapshots') await walkSessions(full, out);
    } else if (e.name === 'messages.jsonl' || e.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
}
