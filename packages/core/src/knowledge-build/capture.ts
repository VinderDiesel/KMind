import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  AssetLinkSchema,
  CodeAnchorSchema,
  KnowledgeTypeIdSchema,
  KMindError,
  type AssetLink,
  type CodeAnchor,
  type KnowledgeType,
} from '@kmind/shared';
import type { Vault } from '../storage/vault.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import type { OntologyRegistry } from '../ontology/ontology-registry.js';
import type { OntologyEvolver } from '../ontology/ontology-evolver.js';
import type { AssetTypeRegistry } from '../asset-types/registry.js';
import { BlobStore } from '../storage/blob-store.js';
import { createPipeline, type CompileResult } from '../compiler/pipeline.js';
import {
  assessCaptureQuality,
  isOverviewTitle,
} from '../compiler/capture-quality.js';
import { assessOverviewChildrenDepth } from '../query/coverage.js';
import { sanitizeTitle } from '../compiler/title.js';

export interface KnowledgeCardCaptureInput {
  project: string;
  title: string;
  type: KnowledgeType;
  content: string;
  anchors?: CodeAnchor[];
  related?: string[];
  links?: AssetLink[];
}

export interface KnowledgeCardCaptureDeps {
  vault: Vault;
  store: SqliteStore;
  registry: OntologyRegistry;
  evolver?: OntologyEvolver;
  assetTypes: AssetTypeRegistry;
}

export interface KnowledgeCardQuality {
  ok: boolean;
  reasons: string[];
  hints: string[];
}

export type CaptureKnowledgeCardResult =
  | {
      ok: true;
      relativePath: string;
      compile: CompileResult;
      quality: KnowledgeCardQuality;
      assetId?: string;
    }
  | {
      ok: false;
      quality: KnowledgeCardQuality;
    };

/**
 * Run the same quality gate used by `kmind capture` without writing anything.
 * Used by the LLM build loop to decide whether to repair or skip a card.
 */
export async function assessKnowledgeCardQuality(
  deps: KnowledgeCardCaptureDeps,
  input: KnowledgeCardCaptureInput,
): Promise<KnowledgeCardQuality> {
  const project = requireProject(input.project);
  const type = parseType(input.type);
  const typeDef = deps.assetTypes.assertCapturable(type);
  const title = sanitizeTitle(input.title || input.content.split('\n')[0] || 'untitled');
  const anchors = normalizeAnchors(input.anchors);
  const related = dedupeIds(input.related);
  const links = normalizeLinks(input.links);

  const peers = await deps.store.queryAssets({ project, limit: 200 });
  const config = await deps.vault.getConfig();
  const quality = assessCaptureQuality(input.content, type, {
    title,
    related,
    links,
    anchors,
    incremental: peers.length > 0,
    hubIds: peers
      .filter((a) => isOverviewTitle(a.title))
      .map((a) => a.id),
    typeDef,
    strictTopic: config.capture.strictTopic === true,
  });

  const reasons = [...quality.reasons];
  if (isOverviewTitle(title) && related && related.length > 0) {
    const resolved = new Map(peers.map((p) => [p.id, p] as const));
    for (const id of related) {
      if (!resolved.has(id)) {
        const asset = await deps.store.getAsset(id);
        if (asset) resolved.set(id, asset);
      }
    }
    const childGate = assessOverviewChildrenDepth(related, (id) =>
      resolved.get(id),
    );
    reasons.push(...childGate.reasons);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    hints: quality.hints,
  };
}

/**
 * Quality-gated manual capture: write raw JSONL → compile → return asset id.
 * This is the reusable CLI/core entry used by `bootstrap run --write`.
 */
export async function captureKnowledgeCard(
  deps: KnowledgeCardCaptureDeps,
  input: KnowledgeCardCaptureInput,
): Promise<CaptureKnowledgeCardResult> {
  const quality = await assessKnowledgeCardQuality(deps, input);
  if (!quality.ok) {
    return { ok: false, quality };
  }

  const project = requireProject(input.project);
  const type = parseType(input.type);
  const title = sanitizeTitle(
    input.title || input.content.split('\n')[0] || 'untitled',
  );
  const anchors = normalizeAnchors(input.anchors);
  const related = dedupeIds(input.related);
  const links = normalizeLinks(input.links);

  const day = new Date().toISOString().slice(0, 10);
  const relativePath = path.join(
    'manual',
    `${day}-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`,
  );
  const blob = new BlobStore(deps.vault.rawDir);
  await blob.writeRaw(
    relativePath,
    `${JSON.stringify({
      role: 'user',
      title,
      type,
      project,
      content: input.content,
      ...(anchors.length ? { anchors } : {}),
      ...(related.length ? { related } : {}),
      ...(links.length ? { links } : {}),
      timestamp: new Date().toISOString(),
    })}\n`,
  );

  const pipeline = createPipeline(deps.vault, {
    sqlite: deps.store,
    registry: deps.registry,
    ...(deps.evolver ? { evolver: deps.evolver } : {}),
    assetTypes: deps.assetTypes,
  });
  const compile = await pipeline.run({
    project,
    incremental: true,
    force: false,
  });

  let assetId = await deps.store.findAssetIdByRawPath(relativePath);
  if (!assetId) {
    const after = await deps.store.queryAssets({ project, limit: 100_000 });
    assetId = after
      .filter((a) => a.title === title)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]?.id;
  }

  return {
    ok: true,
    relativePath,
    compile,
    quality,
    ...(assetId ? { assetId } : {}),
  };
}

function requireProject(raw: string): string {
  const project = raw.trim();
  if (!project || project === 'global') {
    throw new KMindError('capture: 必须传明确 project（禁止缺省/global）', {
      category: 'CAPTURE_ERROR',
      severity: 'high',
      retryable: false,
      suggestion: '使用 --project <name> 指定项目',
    });
  }
  return project;
}

function parseType(raw: string): KnowledgeType {
  const parsed = KnowledgeTypeIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new KMindError(`非法知识类型：${raw}`, {
      category: 'CAPTURE_ERROR',
      severity: 'high',
      retryable: false,
      suggestion: '使用 kmind asset-types 查看可用类型',
    });
  }
  return parsed.data;
}

function normalizeAnchors(anchors?: CodeAnchor[]): CodeAnchor[] {
  if (!anchors?.length) return [];
  const out: CodeAnchor[] = [];
  for (const anchor of anchors) {
    const parsed = CodeAnchorSchema.safeParse(anchor);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function normalizeLinks(links?: AssetLink[]): AssetLink[] {
  if (!links?.length) return [];
  const out: AssetLink[] = [];
  for (const link of links) {
    const parsed = AssetLinkSchema.safeParse(link);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function dedupeIds(ids?: string[]): string[] {
  if (!ids?.length) return [];
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}
