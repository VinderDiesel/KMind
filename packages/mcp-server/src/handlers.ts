import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  type QueryEngine,
  type Vault,
  BlobStore,
  createPipeline,
  SqliteStore,
  OntologyRegistry,
  loadOntology,
  createAssetTypeRegistry,
  Exporter,
  Importer,
  AuditLogger,
  sanitizeTitle,
  assessCaptureQuality,
  assessProjectCoverage,
  assessOverviewChildrenDepth,
  buildCaptureSuggestions,
  loadEvolutionQueue,
  runEvolutionScan,
  isOverviewTitle,
  type AssetTypeRegistry,
  type ExportFilter,
  type ImportConflictPolicy,
} from '@kmind/core';
import {
  AssetLinkSchema,
  KnowledgeTypeIdSchema,
  type KnowledgeType,
  KMindError,
} from '@kmind/shared';
import { MCP_TOOLS, type ToolEffect } from './tools.js';
import { LruTtlCache } from './cache.js';

export interface HandlerContext {
  vault: Vault;
  engine: QueryEngine;
  store: SqliteStore;
  autoApprove: string[];
  terminal?: string;
  assetTypes?: AssetTypeRegistry;
}

const cache = new LruTtlCache<unknown>(256, 30_000);

/**
 * Handle an MCP tool call. Returns compact JSON-serializable payload.
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: HandlerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  const audit = new AuditLogger(ctx.vault.auditDir);
  const effect: ToolEffect = tool?.effect ?? 'sensitive';

  const allowed = await authorize(name, effect, ctx.autoApprove);
  await audit.record({
    terminal: ctx.terminal,
    tool: name,
    argsSummary: JSON.stringify(args ?? {}).slice(0, 200),
    decision: allowed ? 'allowed' : 'blocked',
    reason: allowed ? 'policy ok' : 'write/sensitive not auto-approved',
  });

  if (!allowed) {
    return textResult(
      { error: 'blocked', suggestion: `Add ${name} to mcp.autoApprove or confirm` },
      true,
    );
  }

  try {
    const result = await dispatch(name, args ?? {}, ctx);
    return textResult(result);
  } catch (err) {
    return textResult(
      { error: err instanceof Error ? err.message : String(err) },
      true,
    );
  }
}

async function authorize(
  name: string,
  effect: ToolEffect,
  autoApprove: string[],
): Promise<boolean> {
  if (effect === 'read') return true;
  if (autoApprove.includes(name) || autoApprove.includes('*')) return true;
  // Local-first default: allow write/sensitive when autoApprove empty for CLI-driven mcp-serve
  // Gate can be tightened via KMIND_MCP_STRICT=1
  if (process.env.KMIND_MCP_STRICT === '1') return false;
  return true;
}

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  ctx: HandlerContext,
): Promise<unknown> {
  switch (name) {
    case 'kmind_search': {
      const key = `search:${JSON.stringify(args)}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const results = await ctx.engine.search({
        query: String(args.query ?? ''),
        type: args.type as never,
        project: args.project as string | undefined,
        limit: Number(args.limit ?? 10),
      });
      const payload = results.map((r) => ({
        id: r.asset.id,
        title: r.asset.title,
        score: r.score,
        matchedBy: r.matchedBy,
        type: r.asset.type,
      }));
      cache.set(key, payload);
      return payload;
    }
    case 'kmind_get': {
      const id = String(args.id ?? '');
      const asset = await ctx.engine.getById(id);
      if (!asset) return { error: 'not_found', id };
      return {
        id: asset.id,
        title: asset.title,
        type: asset.type,
        project: asset.project,
        status: asset.status,
        confidence: asset.confidence,
        tags: asset.tags,
        related: asset.related,
        links: asset.links,
        source: asset.source,
        metadata: asset.metadata,
        body: asset.body,
      };
    }
    case 'kmind_problem_status': {
      return ctx.engine.problemStatus(String(args.id ?? ''));
    }
    case 'kmind_coverage': {
      const project = String(args.project ?? '').trim();
      if (!project || project === 'global') {
        return {
          error: 'project_required',
          suggestion: '传明确 project（禁止缺省/global）',
        };
      }
      const topic =
        typeof args.topic === 'string' && args.topic.trim()
          ? args.topic.trim()
          : undefined;
      const hubId =
        typeof args.hubId === 'string' && args.hubId.trim()
          ? args.hubId.trim()
          : undefined;
      return ctx.engine.coverage({ project, topic, hubId });
    }
    case 'kmind_related': {
      const id = String(args.id);
      const depth = Number(args.depth ?? 1);
      const key = `related:${id}:${depth}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const related = await ctx.engine.related(id, depth);
      const payload = related.map((a) => ({ id: a.id, title: a.title, type: a.type }));
      cache.set(key, payload);
      return payload;
    }
    case 'kmind_status': {
      // Short TTL: assetCount changes after capture/compile.
      const key = 'status';
      const hit = cache.get(key);
      if (hit) return hit;
      const status = await ctx.engine.status();
      cache.set(key, status, 5_000);
      return status;
    }
    case 'kmind_ontology_describe': {
      const registry = new OntologyRegistry();
      registry.load(await loadOntology(ctx.vault.ontologyDir));
      return registry.describe(args.class as string | undefined);
    }
    case 'kmind_asset_types': {
      const assetTypes = await resolveAssetTypes(ctx);
      const id =
        typeof args.id === 'string' && args.id.trim() ? args.id.trim() : undefined;
      if (id) {
        const def = assetTypes.get(id);
        if (!def) return { error: 'not_found', id };
        const all = assetTypes.describeAll().find((t) => t.id === id);
        return all ?? { error: 'not_found', id };
      }
      const includeDisabled = args.includeDisabled === true;
      return {
        types: includeDisabled
          ? assetTypes.describeAll()
          : assetTypes.describeEnabled(),
      };
    }
    case 'kmind_pack': {
      const id =
        typeof args.id === 'string' && args.id.trim()
          ? args.id.trim()
          : undefined;
      const query =
        typeof args.query === 'string' && args.query.trim()
          ? args.query.trim()
          : undefined;
      if (!id && !query) {
        return {
          error: 'id_or_query_required',
          suggestion: 'Pass id (k-…) or query for Context Pack',
        };
      }
      const depth = Number(args.depth ?? 1);
      const neighborCap = Number(args.neighborCap ?? 24);
      return ctx.engine.pack({
        id,
        query,
        project:
          typeof args.project === 'string' && args.project.trim()
            ? args.project.trim()
            : undefined,
        type:
          typeof args.type === 'string' && args.type.trim()
            ? (args.type.trim() as never)
            : undefined,
        depth: Number.isFinite(depth) ? depth : 1,
        neighborCap: Number.isFinite(neighborCap) ? neighborCap : 24,
      });
    }
    case 'kmind_evolution_queue': {
      if (args.refresh === true) {
        await runEvolutionScan(ctx.vault, ctx.store);
      }
      const queue = await loadEvolutionQueue(ctx.vault);
      const includeClosed = args.includeClosed === true;
      const limit = Math.min(200, Math.max(1, Number(args.limit ?? 50)));
      const project =
        typeof args.project === 'string' && args.project.trim()
          ? args.project.trim()
          : undefined;
      let items = includeClosed
        ? queue.items
        : queue.items.filter((i) => i.status === 'open');
      if (project) {
        items = items.filter((i) => i.project === project);
      }
      return {
        scannedAt: queue.scannedAt,
        summary: queue.summary,
        items: items.slice(0, limit),
        note: 'Diagnosis only — capture/fix manually; then kmind evolution ack <id>',
      };
    }
    case 'kmind_capture_suggest': {
      const content = String(args.content ?? '');
      const project = String(args.project ?? '').trim();
      if (!content.trim()) {
        return { error: 'content_required' };
      }
      if (!project || project === 'global') {
        return {
          error: 'project_required',
          suggestion: '传明确 project（禁止缺省/global）',
        };
      }
      const title = sanitizeTitle(
        String(args.title ?? content.split('\n')[0] ?? 'untitled'),
      );
      const typeParse = KnowledgeTypeIdSchema.safeParse(args.type);
      const related = Array.isArray(args.related)
        ? args.related.filter((x): x is string => typeof x === 'string')
        : undefined;
      const links = Array.isArray(args.links)
        ? args.links
            .map((item) => AssetLinkSchema.safeParse(item))
            .filter((r) => r.success)
            .map((r) => r.data)
        : undefined;
      const anchors = Array.isArray(args.anchors) ? args.anchors : undefined;
      const assetTypes = await resolveAssetTypes(ctx);
      return buildCaptureSuggestions(
        {
          content,
          title,
          project,
          type: typeParse.success ? typeParse.data : undefined,
          related,
          links,
          anchors: Array.isArray(anchors)
            ? anchors.map((a) => {
                const o = a as {
                  file?: string;
                  symbol?: string;
                  kind?: string;
                  line?: number;
                };
                return {
                  file: o.file,
                  symbol: o.symbol,
                  kind: o.kind,
                  line: o.line,
                };
              })
            : undefined,
        },
        { store: ctx.store, assetTypes },
      );
    }
    case 'kmind_capture': {
      const content = String(args.content);
      const title = sanitizeTitle(
        String(args.title ?? content.split('\n')[0] ?? 'untitled'),
      );
      const project = String(args.project ?? '').trim();
      if (!project || project === 'global') {
        return {
          captured: false,
          error: 'quality_gate',
          reasons: ['必须传明确 project（禁止缺省/global），以便按项目检索'],
          suggestion: '例如 project: "ccdp-ontology" 或 "meta-brain"',
        };
      }
      const typeParse = KnowledgeTypeIdSchema.safeParse(
        args.type ?? 'best_practice',
      );
      const type = typeParse.success ? typeParse.data : 'best_practice';
      const assetTypes = await resolveAssetTypes(ctx);
      let typeDef;
      try {
        typeDef = assetTypes.assertCapturable(type);
      } catch (err) {
        return {
          captured: false,
          error: 'type_gate',
          type,
          reasons: [err instanceof Error ? err.message : String(err)],
          suggestion:
            err instanceof KMindError
              ? err.suggestion
              : 'Call kmind_asset_types for enabled ids',
        };
      }
      const anchors = Array.isArray(args.anchors) ? args.anchors : undefined;
      const related = Array.isArray(args.related)
        ? args.related.filter((x): x is string => typeof x === 'string')
        : undefined;
      const links = Array.isArray(args.links)
        ? args.links
            .map((item) => AssetLinkSchema.safeParse(item))
            .filter((r) => r.success)
            .map((r) => r.data)
        : undefined;
      // Incremental default: if project already has assets, force graph attach + depth.
      const peers = await ctx.store.queryAssets({ project, limit: 200 });
      const hubIds = peers
        .filter((a) => /总览|概览|索引|overview/i.test(a.title))
        .map((a) => a.id);
      const incremental = peers.length > 0;
      const quality = assessCaptureQuality(content, type, {
        title,
        related,
        links,
        anchors: Array.isArray(anchors)
          ? anchors.map((a) => {
              const o = a as { file?: string; symbol?: string };
              return { file: o.file, symbol: o.symbol };
            })
          : undefined,
        incremental,
        hubIds,
        typeDef,
      });
      let overviewChildGate: {
        ok: boolean;
        reasons: string[];
        shallowIds: string[];
      } = { ok: true, reasons: [], shallowIds: [] };
      if (isOverviewTitle(title) && related && related.length > 0) {
        const resolved = new Map(peers.map((p) => [p.id, p] as const));
        for (const id of related) {
          if (!resolved.has(id)) {
            const a = await ctx.store.getAsset(id);
            if (a) resolved.set(id, a);
          }
        }
        overviewChildGate = assessOverviewChildrenDepth(
          related,
          (id: string) => resolved.get(id),
        );
      }
      if (!quality.ok || !overviewChildGate.ok) {
        const suggestReport = await buildCaptureSuggestions(
          {
            content,
            title,
            project,
            type,
            related,
            links,
            anchors: Array.isArray(anchors)
              ? anchors.map((a) => {
                  const o = a as {
                    file?: string;
                    symbol?: string;
                    kind?: string;
                    line?: number;
                  };
                  return {
                    file: o.file,
                    symbol: o.symbol,
                    kind: o.kind,
                    line: o.line,
                  };
                })
              : undefined,
          },
          { store: ctx.store, assetTypes },
        );
        return {
          captured: false,
          error: 'quality_gate',
          title,
          type,
          incremental,
          hubIds,
          reasons: [...quality.reasons, ...overviewChildGate.reasons],
          hints: quality.hints,
          suggestions: suggestReport.suggestions,
          proposedCapture: suggestReport.proposedCapture,
          suggestion:
            '先看 suggestions/proposedCapture；与人对齐后把 apply 字段回灌 kmind_capture。增量须写深：锚点+实现/注意/红线；related/links 挂图；整理后 kmind_coverage。',
        };
      }
      const blob = new BlobStore(ctx.vault.rawDir);
      const day = new Date().toISOString().slice(0, 10);
      const relativePath = path.join('manual', `${day}-${Date.now()}.jsonl`);
      await blob.writeRaw(
        relativePath,
        `${JSON.stringify({
          role: 'user',
          title,
          type,
          project,
          content,
          ...(anchors ? { anchors } : {}),
          ...(related?.length ? { related } : {}),
          ...(links?.length ? { links } : {}),
          timestamp: new Date().toISOString(),
        })}\n`,
      );
      const registry = new OntologyRegistry();
      registry.load(await loadOntology(ctx.vault.ontologyDir));
      const pipeline = createPipeline(ctx.vault, {
        sqlite: ctx.store,
        registry,
        assetTypes,
      });
      const result = await pipeline.run({
        project,
        incremental: true,
        force: false,
      });
      cache.delete('status');
      const afterAssets = await ctx.store.queryAssets({
        project,
        limit: 100_000,
      });
      const topicGuess = guessTopicFromTitle(title);
      const coverage = assessProjectCoverage(afterAssets, {
        project,
        ...(topicGuess ? { topic: topicGuess } : {}),
      });
      return {
        captured: true,
        relativePath,
        title,
        type,
        compile: result,
        coverage: {
          complete: coverage.complete,
          summary: coverage.summary,
          nextActions: coverage.nextActions,
          issueCount: coverage.issues.length,
          hubs: coverage.hubs,
          shallow: coverage.shallow.slice(0, 10),
          duplicateOverviews: coverage.duplicateOverviews,
        },
        claimCompleteAllowed: coverage.complete,
        ...(quality.hints.length ? { hints: quality.hints } : {}),
        ...(coverage.complete
          ? {}
          : {
              warning:
                'coverage.complete=false：禁止对外宣称「知识已完整」；按 coverage.nextActions 继续深挖，勿只刷新总览。',
            }),
      };
    }
    case 'kmind_graph_query': {
      return ctx.engine.graphQuery(String(args.query ?? ''));
    }
    case 'kmind_export': {
      const format = String(args.format ?? 'tar.gz');
      const output =
        (args.output as string) ||
        path.join(
          ctx.vault.root,
          `export-${Date.now()}.${format === 'git' ? 'git' : 'tar.gz'}`,
        );
      const filter = buildExportFilter(args);
      const exporter = new Exporter(ctx.vault);
      if (format === 'git') {
        const manifest = await exporter.exportToGit(output, {
          filter,
          initGit: args.initGit === true,
        });
        return { exported: true, output, format, manifest };
      }
      await fs.mkdir(path.dirname(output), { recursive: true });
      const manifest = await exporter.exportToTarGz(output, filter);
      return { exported: true, output, format, manifest };
    }
    case 'kmind_import': {
      const input = String(args.input ?? '');
      if (!input) return { error: 'Missing input' };
      const format =
        String(args.format ?? '') ||
        (input.endsWith('.tar.gz') || input.endsWith('.tgz') ? 'tar.gz' : 'git');
      const merge = args.merge === true;
      const conflict = parseConflict(args.conflict);
      const importer = new Importer(ctx.vault);
      const result =
        format === 'git'
          ? await importer.importFromDirectory(input, { merge, conflict })
          : await importer.importFromTarGz(input, { merge, conflict });
      cache.delete('status');
      return { imported: true, input, format, merge, conflict, result };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function resolveAssetTypes(ctx: HandlerContext): Promise<AssetTypeRegistry> {
  if (ctx.assetTypes) return ctx.assetTypes;
  return createAssetTypeRegistry(ctx.vault.assetTypesDir);
}

function buildExportFilter(args: Record<string, unknown>): ExportFilter | undefined {
  const projects = toStringList(args.project);
  const types = toStringList(args.type)
    .map((t) => KnowledgeTypeIdSchema.safeParse(t))
    .filter((r): r is { success: true; data: KnowledgeType } => r.success)
    .map((r) => r.data);
  if (!projects.length && !types.length) return undefined;
  return {
    projects: projects.length ? projects : undefined,
    types: types.length ? types : undefined,
  };
}

function toStringList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseConflict(raw: unknown): ImportConflictPolicy {
  const v = String(raw ?? 'skip');
  if (v === 'skip' || v === 'overwrite' || v === 'rename') return v;
  return 'skip';
}

function textResult(
  data: unknown,
  isError = false,
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    ...(isError ? { isError: true } : {}),
  };
}

/** Soft topic hint from overview/detail titles (问数系统知识总览 → 问数). */
function guessTopicFromTitle(title: string): string | undefined {
  const t = title.trim();
  if (!t) return undefined;
  const m = t.match(
    /^(.{2,12}?)(?:系统)?(?:知识)?(?:总览|概览|索引|地图)/,
  );
  if (m?.[1] && m[1].length >= 2) return m[1];
  if (/总览|概览|索引/.test(t)) {
    return t.replace(/(?:系统)?(?:知识)?(?:总览|概览|索引|地图).*$/, '').trim() || undefined;
  }
  return undefined;
}
