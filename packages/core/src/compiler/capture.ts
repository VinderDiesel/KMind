import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AssetLink,
  CodeAnchor,
  KnowledgeType,
  SessionRecord,
} from '@kmind/shared';
import {
  AssetLinkSchema,
  CodeAnchorSchema,
  KnowledgeTypeEnum,
  SessionRecordSchema,
} from '@kmind/shared';
import type { Adapter } from '../adapters/types.js';
import type { BlobStore } from '../storage/blob-store.js';
import type { DiagnosticCollector } from '../observability/diagnostic-collector.js';
import type { RawCandidate } from './classifier.js';
import { sanitizeTitle } from './title.js';

export interface CapturedRaw {
  relativePath: string;
  absolutePath: string;
  session: SessionRecord;
  hash: string;
}

interface RawLine {
  content?: string;
  role?: string;
  title?: string;
  type?: string;
  project?: string;
  anchors?: unknown;
  related?: unknown;
  links?: unknown;
  context?: {
    problem?: string;
    alternatives?: string[];
    decision?: string;
    rationale?: string;
    tradeOffs?: string[];
    outcome?: string;
  };
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
   * Parse a raw JSONL/MD file into a compile candidate.
   * Manual captures may carry title/type/project/context on the JSON line.
   */
  async readRawAsCandidate(absPath: string): Promise<RawCandidate> {
    const content = await fs.readFile(absPath, 'utf8');
    const relativePath = path.relative(this.rawDir, absPath);
    const lines = content
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as RawLine;
        } catch {
          return { content: l } as RawLine;
        }
      });

    const meta = lines.find((l) => l.title || l.type || l.project) ?? lines[0] ?? {};
    const text = lines
      .map((l) => l.content ?? '')
      .join('\n')
      .trim();

    const headingTitle = extractMarkdownTitle(text);
    const rawTitle =
      (typeof meta.title === 'string' && meta.title.trim()) ||
      headingTitle ||
      path.basename(absPath, path.extname(absPath));
    const title = sanitizeTitle(rawTitle);

    const typeHint = parseTypeHint(meta.type) ?? parseTypeFromFooter(text);
    const body = stripCaptureChrome(text, title);

    return {
      title,
      content: body || text,
      rawPath: relativePath,
      typeHint,
      projectHint:
        typeof meta.project === 'string' && meta.project.trim()
          ? meta.project.trim()
          : undefined,
      contextHint: meta.context,
      anchorsHint: parseAnchorsHint(meta.anchors),
      relatedHint: parseRelatedHint(meta.related),
      linksHint: parseLinksHint(meta.links),
    };
  }
}

function parseLinksHint(raw: unknown): AssetLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AssetLink[] = [];
  for (const item of raw) {
    const parsed = AssetLinkSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out.length > 0 ? out : undefined;
}

function parseRelatedHint(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => /^k-\d{4}-\d{2}-\d{2}-\d{3}$/.test(x));
  return ids.length > 0 ? [...new Set(ids)] : undefined;
}

function parseAnchorsHint(raw: unknown): CodeAnchor[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: CodeAnchor[] = [];
  for (const item of raw) {
    const parsed = CodeAnchorSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Remove duplicated `# title` header and trailing `type:` / `project:` footers.
 */
export function stripCaptureChrome(text: string, title: string): string {
  let out = text.trim();
  const heading = new RegExp(`^#\\s*${escapeRegExp(title)}\\s*\\n+`, 'i');
  out = out.replace(heading, '');
  // Drop legacy footers that older captures appended to content.
  out = out.replace(/(?:\n|^)\s*type:\s*[\w-]+\s*/gi, '\n');
  out = out.replace(/(?:\n|^)\s*project:\s*\S+\s*/gi, '\n');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function extractMarkdownTitle(text: string): string | undefined {
  const m = /^#\s+(.+)$/m.exec(text);
  return m?.[1]?.trim();
}

function parseTypeHint(raw: unknown): KnowledgeType | undefined {
  if (typeof raw !== 'string') return undefined;
  const parsed = KnowledgeTypeEnum.safeParse(raw.trim());
  return parsed.success ? parsed.data : undefined;
}

function parseTypeFromFooter(text: string): KnowledgeType | undefined {
  const m = /\ntype:\s*([\w-]+)\s*$/i.exec(text);
  return m ? parseTypeHint(m[1]) : undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // Skip private / archive folders under raw/
    if (entry.name.startsWith('_') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
}
