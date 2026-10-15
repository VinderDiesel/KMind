import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  KnowledgeAssetSchema,
  type KnowledgeAsset,
  KMindError,
} from '@kmind/shared';

/**
 * Read/write knowledge assets as Markdown with YAML frontmatter.
 */
export class MarkdownStore {
  constructor(private readonly knowledgeDir: string) {}

  /** Absolute path for an asset id. */
  pathFor(id: string): string {
    return path.join(this.knowledgeDir, `${id}.md`);
  }

  /**
   * Write a knowledge asset to Markdown.
   */
  async write(asset: KnowledgeAsset): Promise<string> {
    const parsed = KnowledgeAssetSchema.parse(asset);
    const front = toFrontmatter(parsed);
    const body = String(front.body ?? '');
    delete front.body;
    const content = matter.stringify(body, front as Record<string, unknown>);
    const filePath = this.pathFor(parsed.id);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Read a knowledge asset from Markdown.
   */
  async read(id: string): Promise<KnowledgeAsset | null> {
    const filePath = this.pathFor(id);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return parseMarkdown(raw);
    } catch {
      return null;
    }
  }

  /**
   * List all knowledge Markdown files.
   */
  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.knowledgeDir);
      return entries
        .filter((f) => f.endsWith('.md'))
        .map((f) => path.join(this.knowledgeDir, f));
    } catch {
      return [];
    }
  }

  /**
   * Read asset from an arbitrary file path.
   */
  async readFile(filePath: string): Promise<KnowledgeAsset> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return parseMarkdown(raw);
    } catch (cause) {
      throw new KMindError(`Failed to read markdown: ${filePath}`, {
        category: 'INDEX_ERROR',
        severity: 'medium',
        retryable: false,
        suggestion: 'Ensure the knowledge Markdown file is valid',
        cause,
      });
    }
  }
}

function parseMarkdown(raw: string): KnowledgeAsset {
  const { data, content } = matter(raw);
  const asset = {
    ...fromFrontmatter(data as Record<string, unknown>),
    body: content.trim(),
  };
  return KnowledgeAssetSchema.parse(asset);
}

function toFrontmatter(asset: KnowledgeAsset): Record<string, unknown> {
  const source: Record<string, unknown> = {
    terminal: asset.source.terminal,
    raw_path: asset.source.rawPath,
    captured_at: asset.source.capturedAt,
  };
  if (asset.source.sessionId !== undefined) {
    source.session_id = asset.source.sessionId;
  }
  if (asset.source.messageRange !== undefined) {
    source.message_range = asset.source.messageRange;
  }

  const context: Record<string, unknown> = {
    problem: asset.context.problem,
    alternatives: asset.context.alternatives,
    decision: asset.context.decision,
    rationale: asset.context.rationale,
    trade_offs: asset.context.tradeOffs,
  };
  if (asset.context.outcome !== undefined) {
    context.outcome = asset.context.outcome;
  }

  return {
    id: asset.id,
    type: asset.type,
    title: asset.title,
    project: asset.project,
    timestamp: asset.timestamp,
    status: asset.status,
    confidence: asset.confidence,
    expires_at: asset.expiresAt,
    ontology_class: asset.ontologyClass,
    source,
    context,
    tags: asset.tags,
    related: asset.related,
    metadata: asset.metadata,
    body: asset.body,
  };
}

function fromFrontmatter(data: Record<string, unknown>): Omit<KnowledgeAsset, 'body'> {
  const source = (data.source ?? {}) as Record<string, unknown>;
  const context = (data.context ?? {}) as Record<string, unknown>;
  return {
    id: String(data.id),
    type: data.type as KnowledgeAsset['type'],
    title: String(data.title),
    project: String(data.project ?? 'global'),
    timestamp: String(data.timestamp),
    status: (data.status as KnowledgeAsset['status']) ?? 'draft',
    confidence: Number(data.confidence ?? 0.8),
    expiresAt: (data.expires_at as string | null) ?? null,
    ontologyClass: String(data.ontology_class ?? 'BestPractice'),
    source: {
      terminal: source.terminal as KnowledgeAsset['source']['terminal'],
      sessionId: source.session_id as string | undefined,
      messageRange: source.message_range as [number, number] | undefined,
      rawPath: String(source.raw_path ?? ''),
      capturedAt: String(source.captured_at ?? data.timestamp),
    },
    context: {
      problem: String(context.problem ?? ''),
      alternatives: (context.alternatives as string[]) ?? [],
      decision: String(context.decision ?? ''),
      rationale: String(context.rationale ?? ''),
      tradeOffs: (context.trade_offs as string[]) ?? [],
      outcome: context.outcome as string | undefined,
    },
    tags: (data.tags as string[]) ?? [],
    related: (data.related as string[]) ?? [],
    metadata: (data.metadata as Record<string, unknown>) ?? {},
  };
}
