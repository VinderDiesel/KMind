import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  KnowledgeAsset,
  KnowledgeStatus,
  KnowledgeType,
} from '@kmind/shared';
import { MarkdownStore } from './markdown-store.js';

export interface SearchQuery {
  query?: string;
  type?: KnowledgeType;
  project?: string;
  status?: KnowledgeStatus;
  tags?: string[];
  limit?: number;
  minConfidence?: number;
}

/**
 * SQLite index store using Node.js built-in node:sqlite.
 * Rebuildable from Markdown (R-03).
 */
export class SqliteStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  /** Run schema migrations. */
  async migrate(): Promise<void> {
    const schemaPath = resolveSchemaPath();
    const sql = readFileSync(schemaPath, 'utf8');
    this.db.exec(sql);
    // Additive column for existing vaults created before asset_id existed.
    try {
      this.db.exec('ALTER TABLE raw_hashes ADD COLUMN asset_id TEXT');
    } catch {
      /* column already present */
    }
  }

  /** Upsert a knowledge asset and refresh FTS. */
  async upsertAsset(asset: KnowledgeAsset): Promise<void> {
    const upsert = this.db.prepare(
      `INSERT INTO knowledge_assets (
        id, type, title, project, timestamp, status, confidence, expires_at,
        ontology_class, source_terminal, source_session_id, source_raw_path,
        body, context_json, tags_json, related_json, metadata, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        type=excluded.type, title=excluded.title, project=excluded.project,
        timestamp=excluded.timestamp, status=excluded.status, confidence=excluded.confidence,
        expires_at=excluded.expires_at, ontology_class=excluded.ontology_class,
        source_terminal=excluded.source_terminal, source_session_id=excluded.source_session_id,
        source_raw_path=excluded.source_raw_path, body=excluded.body,
        context_json=excluded.context_json, tags_json=excluded.tags_json,
        related_json=excluded.related_json, metadata=excluded.metadata,
        updated_at=datetime('now')`,
    );

    const metadataWithLinks = {
      ...asset.metadata,
      ...(asset.links?.length ? { links: asset.links } : {}),
    };

    this.withTransaction(() => {
      upsert.run(
        asset.id,
        asset.type,
        asset.title,
        asset.project,
        asset.timestamp,
        asset.status,
        asset.confidence,
        asset.expiresAt,
        asset.ontologyClass,
        asset.source.terminal,
        asset.source.sessionId ?? null,
        asset.source.rawPath,
        asset.body,
        JSON.stringify(asset.context),
        JSON.stringify(asset.tags),
        JSON.stringify(asset.related),
        JSON.stringify(metadataWithLinks),
      );

      this.db.prepare('DELETE FROM knowledge_fts WHERE id = ?').run(asset.id);
      this.db
        .prepare(
          'INSERT INTO knowledge_fts (id, title, body, tags) VALUES (?, ?, ?, ?)',
        )
        .run(asset.id, asset.title, asset.body, asset.tags.join(' '));

      // Replace outbound edges owned by this asset (related + typed links).
      this.db.prepare('DELETE FROM relations WHERE from_id = ?').run(asset.id);
      const edgeStmt = this.db.prepare(
        `INSERT OR IGNORE INTO relations (from_id, to_id, relation_type)
         VALUES (?, ?, ?)`,
      );
      for (const relatedId of asset.related) {
        edgeStmt.run(asset.id, relatedId, 'related_to');
      }
      const links =
        asset.links?.length > 0
          ? asset.links
          : Array.isArray(asset.metadata?.links)
            ? (asset.metadata.links as Array<{ id: string; relation: string }>)
            : [];
      for (const link of links) {
        if (!link?.id || !link.relation) continue;
        if (link.relation === 'related_to') {
          edgeStmt.run(asset.id, link.id, 'related_to');
          continue;
        }
        edgeStmt.run(asset.id, link.id, link.relation);
      }
    });
  }

  /**
   * Inbound edges to a target id, optionally filtered by relation type.
   */
  async getInboundRelations(
    toId: string,
    relationType?: string,
  ): Promise<Array<{ fromId: string; relationType: string }>> {
    const rows = relationType
      ? (this.db
          .prepare(
            `SELECT from_id, relation_type FROM relations
             WHERE to_id = ? AND relation_type = ?`,
          )
          .all(toId, relationType) as Array<{
          from_id: string;
          relation_type: string;
        }>)
      : (this.db
          .prepare(
            `SELECT from_id, relation_type FROM relations WHERE to_id = ?`,
          )
          .all(toId) as Array<{ from_id: string; relation_type: string }>);
    return rows.map((r) => ({
      fromId: r.from_id,
      relationType: r.relation_type,
    }));
  }

  async deleteAsset(id: string): Promise<void> {
    this.withTransaction(() => {
      this.db.prepare('DELETE FROM knowledge_fts WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM knowledge_vectors WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM knowledge_assets WHERE id = ?').run(id);
    });
  }

  async getAsset(id: string): Promise<KnowledgeAsset | null> {
    const row = this.db
      .prepare('SELECT * FROM knowledge_assets WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToAsset(row) : null;
  }

  async queryAssets(q: SearchQuery): Promise<KnowledgeAsset[]> {
    const limit = q.limit ?? 10;
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (q.type) {
      clauses.push('type = ?');
      params.push(q.type);
    }
    if (q.project) {
      clauses.push('project = ?');
      params.push(q.project);
    }
    if (q.status) {
      clauses.push('status = ?');
      params.push(q.status);
    }
    if (q.minConfidence !== undefined) {
      clauses.push('confidence >= ?');
      params.push(q.minConfidence);
    }

    if (q.query && q.query.trim()) {
      const fts = this.db
        .prepare(
          `SELECT id FROM knowledge_fts WHERE knowledge_fts MATCH ? LIMIT ?`,
        )
        .all(sanitizeFts(q.query), limit * 5) as Array<{ id: string }>;
      const ids = fts.map((r) => r.id);
      if (ids.length === 0) return [];
      clauses.push(`id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `SELECT * FROM knowledge_assets ${where} ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);
    const rows = this.db
      .prepare(sql)
      .all(...(params as Array<string | number | null>)) as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToAsset);
  }

  async countAssets(): Promise<number> {
    const row = this.db
      .prepare('SELECT COUNT(*) as c FROM knowledge_assets')
      .get() as { c: number };
    return row.c;
  }

  async upsertVector(id: string, embedding: Float32Array): Promise<void> {
    const buf = Buffer.from(
      embedding.buffer,
      embedding.byteOffset,
      embedding.byteLength,
    );
    this.db
      .prepare(
        `INSERT INTO knowledge_vectors (id, embedding, dimension) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET embedding=excluded.embedding, dimension=excluded.dimension`,
      )
      .run(id, buf, embedding.length);
  }

  async getVectors(filter?: {
    project?: string;
    type?: string;
    status?: string;
  }): Promise<Array<{ id: string; embedding: Float32Array }>> {
    let sql = `SELECT v.id, v.embedding FROM knowledge_vectors v
               JOIN knowledge_assets a ON a.id = v.id`;
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.project) {
      clauses.push('a.project = ?');
      params.push(filter.project);
    }
    if (filter?.type) {
      clauses.push('a.type = ?');
      params.push(filter.type);
    }
    if (filter?.status) {
      clauses.push('a.status = ?');
      params.push(filter.status);
    }
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
    const rows = this.db
      .prepare(sql)
      .all(...(params as Array<string | number | null>)) as Array<{
      id: string;
      embedding: Buffer | Uint8Array;
    }>;
    return rows.map((r) => {
      const buf = Buffer.isBuffer(r.embedding)
        ? r.embedding
        : Buffer.from(r.embedding);
      return {
        id: r.id,
        embedding: new Float32Array(
          buf.buffer,
          buf.byteOffset,
          buf.byteLength / 4,
        ),
      };
    });
  }

  async getRelated(id: string, depth = 1): Promise<string[]> {
    const visited = new Set<string>([id]);
    let frontier = [id];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const cur of frontier) {
        const rows = this.db
          .prepare(
            `SELECT to_id AS id FROM relations WHERE from_id = ?
             UNION
             SELECT from_id AS id FROM relations WHERE to_id = ?`,
          )
          .all(cur, cur) as Array<{ id: string }>;
        for (const r of rows) {
          if (!visited.has(r.id)) {
            visited.add(r.id);
            next.push(r.id);
          }
        }
      }
      frontier = next;
    }
    visited.delete(id);
    return [...visited];
  }

  async getRelations(): Promise<
    Array<{ fromId: string; toId: string; relationType: string }>
  > {
    const rows = this.db
      .prepare('SELECT from_id, to_id, relation_type FROM relations')
      .all() as Array<{ from_id: string; to_id: string; relation_type: string }>;
    return rows.map((r) => ({
      fromId: r.from_id,
      toId: r.to_id,
      relationType: r.relation_type,
    }));
  }

  async setRawHash(
    pathKey: string,
    hash: string,
    status: 'pending' | 'compiled' | 'failed',
    assetId?: string,
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO raw_hashes (path, hash, compiled_at, status, asset_id)
         VALUES (?, ?, datetime('now'), ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           hash=excluded.hash,
           compiled_at=excluded.compiled_at,
           status=excluded.status,
           asset_id=COALESCE(excluded.asset_id, raw_hashes.asset_id)`,
      )
      .run(pathKey, hash, status, assetId ?? null);
  }

  async getRawHash(
    pathKey: string,
  ): Promise<{ hash: string; status: string; assetId: string | null } | null> {
    const row = this.db
      .prepare('SELECT hash, status, asset_id FROM raw_hashes WHERE path = ?')
      .get(pathKey) as
      | { hash: string; status: string; asset_id: string | null }
      | undefined;
    return row
      ? { hash: row.hash, status: row.status, assetId: row.asset_id }
      : null;
  }

  /**
   * Find asset id previously compiled from a raw path (stable recompile).
   */
  async findAssetIdByRawPath(rawPath: string): Promise<string | null> {
    const fromHash = this.db
      .prepare('SELECT asset_id FROM raw_hashes WHERE path = ?')
      .get(rawPath) as { asset_id: string | null } | undefined;
    if (fromHash?.asset_id) return fromHash.asset_id;
    const fromAsset = this.db
      .prepare(
        'SELECT id FROM knowledge_assets WHERE source_raw_path = ? LIMIT 1',
      )
      .get(rawPath) as { id: string } | undefined;
    return fromAsset?.id ?? null;
  }

  async setCompileState(phase: string, rawPath?: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO compile_state (id, last_phase, last_raw_path, updated_at)
         VALUES (1, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET last_phase=excluded.last_phase,
           last_raw_path=excluded.last_raw_path, updated_at=datetime('now')`,
      )
      .run(phase, rawPath ?? null);
  }

  async getCompileState(): Promise<{
    lastPhase: string;
    lastRawPath: string | null;
  } | null> {
    const row = this.db
      .prepare(
        'SELECT last_phase, last_raw_path FROM compile_state WHERE id = 1',
      )
      .get() as { last_phase: string; last_raw_path: string | null } | undefined;
    return row
      ? { lastPhase: row.last_phase, lastRawPath: row.last_raw_path }
      : null;
  }

  async getLastCompileTime(): Promise<string | null> {
    const row = this.db
      .prepare(
        `SELECT MAX(compiled_at) as t FROM raw_hashes WHERE status = 'compiled'`,
      )
      .get() as { t: string | null };
    return row.t;
  }

  /**
   * Rebuild entire index from Markdown knowledge directory.
   */
  async rebuildFromMarkdown(knowledgeDir: string): Promise<void> {
    const store = new MarkdownStore(knowledgeDir);
    const files = await store.list();
    this.withTransaction(() => {
      this.db.exec('DELETE FROM knowledge_fts');
      this.db.exec('DELETE FROM relations');
      this.db.exec('DELETE FROM knowledge_entities');
      this.db.exec('DELETE FROM knowledge_vectors');
      this.db.exec('DELETE FROM knowledge_assets');
    });
    for (const file of files) {
      const asset = await store.readFile(file);
      await this.upsertAsset(asset);
    }
  }

  close(): void {
    this.db.close();
  }

  private withTransaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

function rowToAsset(row: Record<string, unknown>): KnowledgeAsset {
  return {
    id: String(row.id),
    type: row.type as KnowledgeAsset['type'],
    title: String(row.title),
    project: String(row.project),
    timestamp: String(row.timestamp),
    status: row.status as KnowledgeAsset['status'],
    confidence: Number(row.confidence),
    expiresAt: (row.expires_at as string | null) ?? null,
    ontologyClass: String(row.ontology_class),
    source: {
      terminal: row.source_terminal as KnowledgeAsset['source']['terminal'],
      sessionId: (row.source_session_id as string | null) ?? undefined,
      rawPath: String(row.source_raw_path),
      capturedAt: String(row.timestamp),
    },
    context: JSON.parse(String(row.context_json || '{}')),
    tags: JSON.parse(String(row.tags_json || '[]')),
    related: JSON.parse(String(row.related_json || '[]')),
    links: (() => {
      const meta = JSON.parse(String(row.metadata || '{}')) as Record<
        string,
        unknown
      >;
      return Array.isArray(meta.links)
        ? (meta.links as KnowledgeAsset['links'])
        : [];
    })(),
    body: String(row.body),
    metadata: JSON.parse(String(row.metadata || '{}')),
  };
}

function sanitizeFts(query: string): string {
  return query
    .replace(/["']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(' OR ');
}

function resolveSchemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'migrations', 'schema.sql'),
    join(here, '..', 'storage', 'migrations', 'schema.sql'),
    join(process.cwd(), 'packages/core/src/storage/migrations/schema.sql'),
    join(process.cwd(), 'packages/core/dist/storage/migrations/schema.sql'),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error('schema.sql not found');
}
