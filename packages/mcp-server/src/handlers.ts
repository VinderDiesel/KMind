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
  Exporter,
  AuditLogger,
} from '@kmind/core';
import { KnowledgeTypeEnum } from '@kmind/shared';
import { MCP_TOOLS, type ToolEffect } from './tools.js';
import { LruTtlCache } from './cache.js';

export interface HandlerContext {
  vault: Vault;
  engine: QueryEngine;
  store: SqliteStore;
  autoApprove: string[];
  terminal?: string;
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
      const key = 'status';
      const hit = cache.get(key);
      if (hit) return hit;
      const status = await ctx.engine.status();
      cache.set(key, status, 600_000);
      return status;
    }
    case 'kmind_ontology_describe': {
      const registry = new OntologyRegistry();
      registry.load(await loadOntology(ctx.vault.ontologyDir));
      return registry.describe(args.class as string | undefined);
    }
    case 'kmind_capture': {
      const content = String(args.content);
      const title = String(args.title ?? content.slice(0, 80));
      const project = String(args.project ?? 'global');
      const typeParse = KnowledgeTypeEnum.safeParse(args.type ?? 'best_practice');
      const type = typeParse.success ? typeParse.data : 'best_practice';
      const blob = new BlobStore(ctx.vault.rawDir);
      const day = new Date().toISOString().slice(0, 10);
      const relativePath = path.join('manual', `${day}-${Date.now()}.md`);
      await blob.writeRaw(
        relativePath,
        JSON.stringify({
          role: 'user',
          content: `# ${title}\n\n${content}\n\ntype: ${type}\nproject: ${project}`,
          timestamp: new Date().toISOString(),
        }) + '\n',
      );
      const registry = new OntologyRegistry();
      registry.load(await loadOntology(ctx.vault.ontologyDir));
      const pipeline = createPipeline(ctx.vault, { sqlite: ctx.store, registry });
      const result = await pipeline.run({ project, incremental: false, force: true });
      return { captured: true, relativePath, compile: result };
    }
    case 'kmind_graph_query': {
      return ctx.engine.graphQuery(String(args.query ?? ''));
    }
    case 'kmind_export': {
      const format = String(args.format ?? 'tar.gz');
      const output =
        (args.output as string) ||
        path.join(ctx.vault.root, `export-${Date.now()}.${format === 'git' ? 'git' : 'tar.gz'}`);
      const exporter = new Exporter(ctx.vault);
      if (format === 'git') {
        await exporter.exportToGit(output);
      } else {
        await fs.mkdir(path.dirname(output), { recursive: true });
        await exporter.exportToTarGz(output);
      }
      return { exported: true, output };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
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
