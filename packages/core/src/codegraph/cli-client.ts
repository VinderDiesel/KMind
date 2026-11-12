import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  CodegraphCaller,
  CodegraphClient,
  CodegraphSymbolMatch,
} from './types.js';

const execFileAsync = promisify(execFile);

export interface CliCodegraphClientOptions {
  command?: string;
  timeoutMs?: number;
}

/**
 * Codegraph CLI adapter (`codegraph status|query|callers -j`).
 * Never opens `.codegraph/` SQLite from Node.
 */
export function createCliCodegraphClient(
  options: CliCodegraphClientOptions = {},
): CodegraphClient {
  const command = options.command?.trim() || 'codegraph';
  const timeoutMs = options.timeoutMs ?? 15_000;

  const runJson = async (
    args: string[],
  ): Promise<{ ok: true; data: unknown } | { ok: false }> => {
    try {
      const { stdout } = await execFileAsync(command, args, {
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      });
      const text = stdout.trim();
      if (!text) return { ok: false };
      // CLI may print a human note after JSON; take first JSON value.
      const jsonStart = text.indexOf('{') >= 0 && (text.indexOf('[') < 0 || text.indexOf('{') < text.indexOf('['))
        ? text.indexOf('{')
        : text.indexOf('[');
      if (jsonStart < 0) return { ok: false };
      const sliced = text.slice(jsonStart);
      // Prefer full parse; if trailing prose, try progressive trim
      try {
        return { ok: true, data: JSON.parse(sliced) };
      } catch {
        const lastBrace = Math.max(sliced.lastIndexOf('}'), sliced.lastIndexOf(']'));
        if (lastBrace <= 0) return { ok: false };
        return { ok: true, data: JSON.parse(sliced.slice(0, lastBrace + 1)) };
      }
    } catch {
      return { ok: false };
    }
  };

  return {
    async isAvailable(projectPath: string): Promise<boolean> {
      const res = await runJson(['status', '-j', projectPath]);
      if (!res.ok || !res.data || typeof res.data !== 'object') return false;
      return Boolean((res.data as { initialized?: boolean }).initialized);
    },

    async findSymbol(opts): Promise<{
      found: boolean;
      matches: CodegraphSymbolMatch[];
    }> {
      const res = await runJson([
        'query',
        '-j',
        '-l',
        '20',
        '-p',
        opts.projectPath,
        opts.symbol,
      ]);
      if (!res.ok || !Array.isArray(res.data)) {
        return { found: false, matches: [] };
      }
      const matches: CodegraphSymbolMatch[] = [];
      for (const row of res.data) {
        if (!row || typeof row !== 'object') continue;
        const node = (row as { node?: Record<string, unknown> }).node;
        if (!node || typeof node.name !== 'string') continue;
        const filePath =
          typeof node.filePath === 'string' ? node.filePath : '';
        const name = node.name;
        const qn =
          typeof node.qualifiedName === 'string'
            ? node.qualifiedName
            : undefined;
        if (!symbolNameMatches(opts.symbol, name, qn)) continue;
        if (opts.file && filePath && !filePathMatches(opts.file, filePath)) {
          continue;
        }
        matches.push({
          name,
          filePath,
          kind: typeof node.kind === 'string' ? node.kind : undefined,
          qualifiedName: qn,
          startLine:
            typeof node.startLine === 'number' ? node.startLine : undefined,
        });
      }
      return { found: matches.length > 0, matches };
    },

    async listCallers(opts): Promise<CodegraphCaller[]> {
      const args = [
        'callers',
        '-j',
        '-l',
        String(opts.limit ?? 8),
        '-p',
        opts.projectPath,
      ];
      if (opts.file?.trim()) {
        args.push('-f', opts.file.trim());
      }
      args.push(opts.symbol);
      const res = await runJson(args);
      if (!res.ok || !res.data || typeof res.data !== 'object') return [];
      const raw = res.data as {
        callers?: unknown[];
        definitions?: Array<{ callers?: unknown[] }>;
      };
      const list =
        Array.isArray(raw.callers) && raw.callers.length > 0
          ? raw.callers
          : (raw.definitions?.[0]?.callers ?? []);
      const out: CodegraphCaller[] = [];
      for (const c of list) {
        if (!c || typeof c !== 'object') continue;
        const o = c as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name : undefined;
        const filePath =
          typeof o.filePath === 'string' ? o.filePath : undefined;
        if (!name || !filePath) continue;
        out.push({
          name,
          filePath,
          kind: typeof o.kind === 'string' ? o.kind : undefined,
          startLine:
            typeof o.startLine === 'number' && o.startLine > 0
              ? o.startLine
              : undefined,
        });
      }
      return out;
    },
  };
}

/**
 * Match symbol name against Codegraph node name / qualifiedName.
 */
export function symbolNameMatches(
  want: string,
  name: string,
  qualifiedName?: string,
): boolean {
  const w = want.trim();
  if (!w) return false;
  if (name === w) return true;
  if (qualifiedName === w) return true;
  if (qualifiedName?.endsWith(`.${w}`) || qualifiedName?.endsWith(`::${w}`)) {
    return true;
  }
  return false;
}

/**
 * Anchor file path vs indexed filePath (suffix / basename tolerant).
 */
export function filePathMatches(anchorFile: string, indexedPath: string): boolean {
  const a = anchorFile.replace(/\\/g, '/').replace(/^\.\//, '');
  const b = indexedPath.replace(/\\/g, '/');
  if (b === a || b.endsWith(`/${a}`) || a.endsWith(`/${b}`)) return true;
  const aBase = a.split('/').pop() ?? a;
  const bBase = b.split('/').pop() ?? b;
  return aBase === bBase && aBase.length > 0;
}
